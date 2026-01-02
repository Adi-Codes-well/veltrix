import * as vscode from "vscode";
import { AIService } from "./AIService";
import * as path from "path";

// 1. Define what an "Agent" looks like
interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;

  // 2. We removed 'private aiService'. It is now created dynamically.

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext // 🟢 NEW: Added Context
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
        
        // 🟢 NEW: Save an Agent Profile
        case "saveAgent": {
            const agent = data.value as AgentConfig;
            const apiKey = data.apiKey; // Front-end sends this separately

            // Save the Profile (Name, Prompt, Model) to Global State
            const agents = this._context.globalState.get<AgentConfig[]>("agents") || [];
            // Update if exists, or push new
            const index = agents.findIndex(a => a.id === agent.id);
            if (index > -1) {
                agents[index] = agent;
            } else {
                agents.push(agent);
            }
            await this._context.globalState.update("agents", agents);

            // Save the API Key to Secure Storage (Encrypted)
            if (apiKey) {
                await this._context.secrets.store(`agent-key-${agent.id}`, apiKey);
            }

            // Tell the UI the update is done
            this._view?.webview.postMessage({ type: "updateAgents", value: agents });
            break;
        }

        // 🟢 NEW: Load Agents on Startup
        case "getAgents": {
            const agents = this._context.globalState.get<AgentConfig[]>("agents") || [];
            this._view?.webview.postMessage({ type: "updateAgents", value: agents });
            break;
        }

        // 🟢 UPDATED: Chat with a specific Agent
        case "onPrompt": {
          if (!data.value) {
            return;
          }
          
          const activeAgentId = data.agentId; // UI must send this!
          
          // 1. Find the Agent Profile
          const agents = this._context.globalState.get<AgentConfig[]>("agents") || [];
          const agent = agents.find(a => a.id === activeAgentId);

          if (!agent) {
             this._view?.webview.postMessage({ type: "onToken", value: "Error: Agent not found." });
             return;
          }

          // 2. Get their API Key
          const apiKey = await this._context.secrets.get(`agent-key-${agent.id}`);
          if (!apiKey) {
             this._view?.webview.postMessage({ type: "onToken", value: "Error: API Key missing." });
             return;
          }

          // 3. Initialize Service Dynamically
          // Note: You must update AIService.ts to accept these 3 params!
          const aiService = new AIService(apiKey, agent.systemPrompt, agent.model);

          const projectTree = await this._getProjectStructure();
          // 4. Get Context & Stream
          const editor = vscode.window.activeTextEditor;
          const currentCode = editor ? editor.document.getText() : "";

          const enrichedPrompt = `
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

        case "requestDiff": {
            const { path: filePath, content } = data.value;
            
            // Create a temp file to compare against
            // Note: In a real app, you might use 'untitled:' schema, but writing to a temp file is safer for diffs

            const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) {
        vscode.window.showErrorMessage("No workspace opened");
        return;
    }

            const openPath = vscode.Uri.file(path.join(rootPath, filePath));
            const newFileUri = vscode.Uri.parse(`untitled:${openPath.fsPath}.new`);
            
            const doc = await vscode.workspace.openTextDocument(newFileUri);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(newFileUri, new vscode.Position(0, 0), content);
            await vscode.workspace.applyEdit(edit);

            // Open the Diff
            await vscode.commands.executeCommand("vscode.diff", openPath, newFileUri, `Review: ${filePath}`);
            break;
        }
      }
    });
  }

  // ... (Your _getHtmlForWebview and getNonce functions stay exactly the same)
  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist", "assets", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist", "assets", "index.css"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
    if (!workspaceFolders) {
      return "";
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    
    // Ignore node_modules, .git, dist, etc.
    const ignorePatterns = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**"];
    const files = await vscode.workspace.findFiles("**/*", `{${ignorePatterns.join(",")}}`);

    // Convert file paths to a simple tree string
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