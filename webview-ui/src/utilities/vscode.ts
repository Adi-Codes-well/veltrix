// ✅ Inline declaration (NO imports needed)
interface VSCodeWebviewApi<T = unknown> {
  postMessage(message: T): void;
  getState(): T | undefined;
  setState(state: T): void;
}

// ✅ Single declaration (only once)
declare function acquireVsCodeApi<T = unknown>(): VSCodeWebviewApi<T>;

class VSCodeAPIWrapper {
  private vsCodeApi?: VSCodeWebviewApi<unknown>;

  constructor() {
    // Check if running inside VS Code Webview
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  public postMessage(message: unknown) {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      console.log("VS Code API unavailable (Are you outside a webview?)");
    }
  }
}

export const vscode = new VSCodeAPIWrapper();
