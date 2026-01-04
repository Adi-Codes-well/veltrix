import React, { useState, useEffect, useRef } from "react";
import { vscode } from "../utilities/vscode";
import { parseTools } from "../utilities/toolParser";
import "./ChatView.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

// [NEW] Interface for the pending file change
interface PendingChange {
  path: string;
  content: string;
}

export const ChatView = () => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  
  // [NEW] State to track if we are currently reviewing code
  const [pendingDiff, setPendingDiff] = useState<PendingChange | null>(null);

  const streamBuffer = useRef(""); 

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "onToken":
          if (!streamBuffer.current) {
            setIsThinking(true);
            setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
          }
          streamBuffer.current += message.value;
          setMessages((prev) => {
            const newHistory = [...prev];
            const lastMsg = newHistory[newHistory.length - 1];
            if (lastMsg.role === "assistant") {
              lastMsg.content = streamBuffer.current;
            }
            return newHistory;
          });
          break;

        case "onComplete": {
          setIsThinking(false);
          const tools = parseTools(streamBuffer.current);
          
          tools.forEach((tool) => {
            console.log("Parsed Tool:", tool);

            // [NEW] INTERCEPTION LOGIC
            if (tool.type === "requestDiff") {
                // 1. Store the change data in state (shows the UI)
                setPendingDiff(tool.value as PendingChange);
                
                // 2. Tell VS Code to open the visual Diff Editor
                vscode.postMessage({
                    type: "requestDiff",
                    value: tool.value
                });
            } else {
                // 3. For other tools (readFile, executeCommand), run immediately
                vscode.postMessage({
                    type: tool.type,
                    value: tool.value,
                });
            }
          });

          streamBuffer.current = "";
          break;
        }
        
        case "updateAgents":
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    vscode.postMessage({ 
      type: "onPrompt", 
      value: input,
      agentId: "default-agent-id" 
    });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // [NEW] Button Handler: User clicked Accept
  const handleAcceptDiff = () => {
    if (!pendingDiff) return;

    // Send the confirm signal to write the file
    vscode.postMessage({
        type: "applyFile",
        value: pendingDiff
    });

    setPendingDiff(null); // Hide UI
    // Optional: Add a small system note to UI
    setMessages(prev => [...prev, { role: "user", content: "✅ Changes approved." }]);
  };

  // [NEW] Button Handler: User clicked Reject
  const handleRejectDiff = () => {
    if (!pendingDiff) return;

    // Close the diff view in VS Code (optional, implies you need a handler in backend)
    vscode.postMessage({ type: "executeCommand", value: "workbench.action.closeActiveEditor" });

    // Send feedback to the agent so it knows to try again
    const rejectionMessage = `I rejected the changes to ${pendingDiff.path}. Please review the code and try a different approach.`;
    
    // Reset state
    setPendingDiff(null);

    // Auto-send the rejection message to the LLM
    vscode.postMessage({ 
        type: "onPrompt", 
        value: rejectionMessage,
        agentId: "default-agent-id"
    });
    
    setMessages(prev => [...prev, { role: "user", content: "❌ Changes rejected." }]);
  };

  return (
    <div className="chat-container">
      <div className="messages-list">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-header">
              {msg.role === "user" ? "You" : "Agent"}
            </div>
            <div className="message-content">
              {msg.content}
            </div>
          </div>
        ))}
        
        {/* [NEW] REVIEW UI COMPONENT */}
        {pendingDiff && (
            <div className="review-container" style={{
                marginTop: '1rem',
                padding: '10px',
                border: '1px solid var(--vscode-focusBorder)',
                borderRadius: '5px',
                backgroundColor: 'var(--vscode-editor-background)'
            }}>
                <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
                    📝 Reviewing: {pendingDiff.path}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button 
                        onClick={handleAcceptDiff}
                        style={{ backgroundColor: 'var(--vscode-charts-green)', color: 'white', flex: 1 }}
                    >
                        Accept
                    </button>
                    <button 
                        onClick={handleRejectDiff}
                        style={{ backgroundColor: 'var(--vscode-errorForeground)', color: 'white', flex: 1 }}
                    >
                        Reject
                    </button>
                </div>
            </div>
        )}

        {isThinking && <div className="loading-indicator">Thinking...</div>}
      </div>

      <div className="input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask your agent to code..."
          rows={3}
          // [NEW] Disable input while reviewing to force a decision
          disabled={!!pendingDiff} 
        />
        <button onClick={handleSend} disabled={isThinking || !!pendingDiff}>
          Send
        </button>
      </div>
    </div>
  );
};