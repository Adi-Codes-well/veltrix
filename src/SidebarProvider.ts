import * as vscode from "vscode";
import { AIService } from "./AIService";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  private aiService: AIService;

  constructor(private readonly _extensionUri: vscode.Uri) {
    // ⚠️ Ideally, fetch this from vscode.workspace.getConfiguration()
    this.aiService = new AIService("YOUR_OPENAI_API_KEY_HERE");
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      // Restrict the webview to only loading content from our extension's `webview-ui/dist` directory
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist")
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for messages from the React UI
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "onPrompt": {
          if (!data.value) {
            return;
        }

          // 1. Get the current code context (if a file is open)
          const editor = vscode.window.activeTextEditor;
          const currentCode = editor ? editor.document.getText() : undefined;

          try {
            // 2. Stream the response from AIService
            // We pass the user's prompt (data.value) and the code context
            for await (const token of this.aiService.streamChat(data.value, currentCode)) {
              if (this._view) {
                this._view.webview.postMessage({ type: "onToken", value: token });
              }
            }
            
            // 3. Signal that streaming is done
            if (this._view) {
              this._view.webview.postMessage({ type: "onComplete" });
            }

          } catch (error) {
            // Handle API errors gracefully
             if (this._view) {
                this._view.webview.postMessage({ 
                    type: "onToken", 
                    value: `\n\nError: ${error instanceof Error ? error.message : "Unknown error"}` 
                });
                this._view.webview.postMessage({ type: "onComplete" });
             }
          }
          break;
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    // ⚠️ NOTE: This assumes your Vite build outputs to 'webview-ui/dist/assets/index.js'
    // You must configure Vite to output fixed filenames (see Step 2 below)
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist", "assets", "index.js")
    );
    
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist", "assets", "index.css")
    );

    // Use a nonce to only allow specific scripts to run.
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
}

// Helper function to generate a random string for security
function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}