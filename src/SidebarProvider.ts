import * as vscode from "vscode";
import { AIService } from "./AIService";
import { AgentConfig } from "./types";
import { ProjectManager } from "./ProjectManager";
import * as path from "path";


export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  private projectManager: ProjectManager;
  private activeAgentId: string | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this.projectManager = new ProjectManager(_context);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist")
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        
        case "saveAgent": {
            const agent = data.value as AgentConfig;
            const apiKey = data.apiKey;
            const agents = this._context.globalState.get<AgentConfig[]>("agents") || [];
            const index = agents.findIndex(a => a.id === agent.id);
            if (index > -1) { agents[index] = agent; } else { agents.push(agent); }
            await this._context.globalState.update("agents", agents);
            if (apiKey) { await this._context.secrets.store(`agent-key-${agent.id}`, apiKey); }
            this._view?.webview.postMessage({ type: "updateAgents", value: agents });
            break;
        }

        case "getAgents": {
            const agents = this._context.globalState.get<AgentConfig[]>("agents") || [];
            this._view?.webview.postMessage({ type: "updateAgents", value: agents });
            break;
        }

        case "onPrompt": {
    if (!data.value) {
        return;
    }
    
    // Set the state so recursive calls know who the agent is
    this.activeAgentId = data.agentId; 
    
    // Trigger the cycle
    await this._runAgentCycle(data.value, false);
    break;
}

        case "executeCommand": {
            const command = data.value;
            const terminal = vscode.window.createTerminal(`Veltrix: ${command}`);
            terminal.show();
            terminal.sendText(command);
            break;
        }
        
        case "requestDiff": {
            const { path: filePath, content } = data.value;
            const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (!rootPath) { return; }

            const openPath = vscode.Uri.file(path.join(rootPath, filePath));
            // Use a unique name so the diff doesn't get stuck on old content
            const newFileUri = vscode.Uri.parse(`untitled:${openPath.fsPath}.${Date.now()}.new`);
            
            const doc = await vscode.workspace.openTextDocument(newFileUri);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(newFileUri, new vscode.Position(0, 0), content);
            await vscode.workspace.applyEdit(edit);

            await vscode.commands.executeCommand("vscode.diff", openPath, newFileUri, `Review: ${filePath}`);
            break;
        }

       case "applyFile": {
    const { path: filePath, content } = data.value;
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) { return; }

    const uri = vscode.Uri.file(path.join(rootPath, filePath));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));

    vscode.window.showInformationMessage(`✅ Updated ${filePath}`);
    
    // Close the diff editor (optional but clean UX)
    vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    // Add confirmation to history
    const systemMessage = `System: Successfully updated ${filePath}.`;
    this.projectManager.addMessage('system', systemMessage);

    // CONTINUE THE LOOP
    // The AI needs to know it succeeded so it can move to the next task
    await this._runAgentCycle("", true); 
    break;
}

        case "readFile": {
    const filePath = data.value;
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) return;

    const uri = vscode.Uri.file(path.join(rootPath, filePath));
    try {
        const uint8Array = await vscode.workspace.fs.readFile(uri);
        const fileContent = Buffer.from(uint8Array).toString('utf-8');
        
        // Inject file content into history
        const systemMessage = `
<file_content path="${filePath}">
${fileContent}
</file_content>
`;
        this.projectManager.addMessage('system', systemMessage);
        
        // Continue the loop automatically
        await this._runAgentCycle("", true); 
        
    } catch (error) {
        this.projectManager.addMessage('system', `Error reading ${filePath}: ${error}`);
        await this._runAgentCycle("", true);
    }
    break;
}
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist", "assets", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist", "assets", "index.css"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <title>AI Team</title>
      </head>
      <body>
        <div id="root"></div>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  private async _getProjectStructure(): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return "";
    const rootPath = workspaceFolders[0].uri.fsPath;
    const ignorePatterns = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**"];
    const files = await vscode.workspace.findFiles("**/*", `{${ignorePatterns.join(",")}}`);
    const relativePaths = files.map(file => path.relative(rootPath, file.fsPath));
    return "Project Structure:\n" + relativePaths.join("\n");
  }

  // ... existing methods ...

  private async _runAgentCycle(userPrompt: string, isSystemContinuation: boolean = false) {
    // 1. Validation: Ensure we have an active agent
    if (!this.activeAgentId) {
        this._view?.webview.postMessage({ type: "onToken", value: "Error: No active agent selected." });
        return;
    }

    const agents = this._context.globalState.get<AgentConfig[]>("agents") || [];
    const agent = agents.find(a => a.id === this.activeAgentId);

    if (!agent) {
        this._view?.webview.postMessage({ type: "onToken", value: "Error: Agent configuration not found." });
        return;
    }

    const apiKey = await this._context.secrets.get(`agent-key-${agent.id}`);
    if (!apiKey) {
        this._view?.webview.postMessage({ type: "onToken", value: "Error: API Key missing." });
        return;
    }

    // 2. Update History (Only if it's a new user prompt, not a system recursion)
    if (userPrompt && !isSystemContinuation) {
        this.projectManager.addMessage('user', userPrompt);
    }

    // 3. Prepare Context and Service
    const aiService = new AIService(apiKey, agent.systemPrompt, agent.model);
    const projectTree = await this._getProjectStructure();
    
    // Get active file content if available
    const editor = vscode.window.activeTextEditor;
    const currentCode = editor ? editor.document.getText() : "(No active file)";

    const formattingInstructions = `
You are an elite coding agent. Follow this strict process:
1. **EXPLORE:** If you need to edit a file, check if it's in [CURRENT OPEN FILE]. If not, you MUST use <read_file path="src/main.ts" /> first.
2. **THINK:** Plan your changes.
3. **ACT:** Generate code using <write_file>.

**CRITICAL RULES:**
- <write_file> must contain the **COMPLETE** file content. No comments like "// ... rest of code".
- Existing code must be preserved exactly.

**TOOLS:**
- <read_file path="relative/path/to/file" />
- <write_file path="relative/path/to/file">FULL CONTENT HERE</write_file>
- <execute_command>npm run test</execute_command>
`;

    // 4. Construct Final Prompt
    // We get the conversation history from ProjectManager
    const historyContext = this.projectManager.getContextPrompt(); 

    const enrichedPrompt = `
${formattingInstructions}

${historyContext} 

Current Project Structure:
${projectTree}

Current Open File Code:
${currentCode}

${!isSystemContinuation ? `User Request: ${userPrompt}` : "System: Continue based on the previous output."}
`;

    // 5. Stream Response
    let fullResponse = "";
    
    try {
        // Send a signal that we are thinking
        this._view?.webview.postMessage({ type: "onToken", value: "" }); 

        for await (const token of aiService.streamChat(enrichedPrompt, "")) {
            fullResponse += token;
            this._view?.webview.postMessage({ type: "onToken", value: token });
        }

        // 6. Save Assistant Response to History
        this.projectManager.addMessage('assistant', fullResponse);
        this._view?.webview.postMessage({ type: "onComplete" });

    } catch (error) {
        this._view?.webview.postMessage({ 
            type: "onToken", 
            value: `\nError: ${error instanceof Error ? error.message : "Unknown"}` 
        });
        this._view?.webview.postMessage({ type: "onComplete" });
    }
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}