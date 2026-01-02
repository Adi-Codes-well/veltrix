import * as vscode from "vscode";
import { AIService } from "./AIService";
import * as path from "path";

interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

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
          if (!data.value) return;
          
          const activeAgentId = data.agentId; 
          const agents = this._context.globalState.get<AgentConfig[]>("agents") || [];
          const agent = agents.find(a => a.id === activeAgentId);

          if (!agent) {
             this._view?.webview.postMessage({ type: "onToken", value: "Error: Agent not found." });
             return;
          }

          const apiKey = await this._context.secrets.get(`agent-key-${agent.id}`);
          if (!apiKey) {
             this._view?.webview.postMessage({ type: "onToken", value: "Error: API Key missing." });
             return;
          }

          const aiService = new AIService(apiKey, agent.systemPrompt, agent.model);
          const projectTree = await this._getProjectStructure();
          const editor = vscode.window.activeTextEditor;
          const currentCode = editor ? editor.document.getText() : "";

          // 🟢 CRITICAL: We FORCE the agent to use XML tags here.
          // This ensures the code goes into the File Area (Diff View), not the Chat.
          const formattingInstructions = `
            IMPORTANT: You are an agent that edits files.
            When you write code, you MUST wrap it in these XML tags:
            <write_file path="src/App.tsx">
            ... code ...
            </write_file>
            
            When you want to run a command:
            <execute_command>npm install</execute_command>
            
            DO NOT use standard markdown code blocks (like \`\`\`typescript).
            ALWAYS use the XML tags.
          `;

          const enrichedPrompt = `
            ${formattingInstructions}

            Current Project Structure:
            ${projectTree}

            Current Open File Code:
            ${currentCode}

            User Request: ${data.value}
          `;

          try {
            for await (const token of aiService.streamChat(enrichedPrompt, "")) {
              this._view?.webview.postMessage({ type: "onToken", value: token });
            }
            this._view?.webview.postMessage({ type: "onComplete" });
          } catch (error) {
             this._view?.webview.postMessage({ 
                type: "onToken", 
                value: `Error: ${error instanceof Error ? error.message : "Unknown"}` 
            });
            this._view?.webview.postMessage({ type: "onComplete" });
          }
          break;
        }

        case "executeCommand": {
            const command = data.value;
            const terminal = vscode.window.createTerminal(`Veltrix: ${command}`);
            terminal.show();
            terminal.sendText(command);
            break;
        }
        
        // 🟢 1. VIEW DIFF (The "Before vs After" View)
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

        // 🟢 2. ACCEPT CHANGE (Writes to the actual file)
        case "applyFile": {
            const { path: filePath, content } = data.value;
            const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (!rootPath) { return; }

            const uri = vscode.Uri.file(path.join(rootPath, filePath));
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
            
            vscode.window.showInformationMessage(`✅ Applied changes to ${filePath}`);
            // Optional: Close the diff editor after applying
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
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
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}