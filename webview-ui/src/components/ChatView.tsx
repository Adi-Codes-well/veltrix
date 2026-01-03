import React, { useState, useEffect, useRef } from "react";
import { vscode } from "../utilities/vscode"; // Standard VSCode API wrapper
import { parseTools } from "../utilities/toolParser";
import "./ChatView.css"; // Assume basic styling exists

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const ChatView = () => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  
  // We use a ref to track the current streaming message content
  // because state updates in event listeners can be tricky.
  const streamBuffer = useRef(""); 

  useEffect(() => {
    // Listener for messages from the Extension Backend
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "onToken":
          // If this is the start of a new response
          if (!streamBuffer.current) {
            setIsThinking(true);
            setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
          }

          // Append token to buffer
          streamBuffer.current += message.value;

          // Update the UI (the last message in the list)
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
          
          // CRITICAL: Parse tools from the completed message
          const tools = parseTools(streamBuffer.current);
          
          // Execute detected tools
          tools.forEach((tool) => {
            console.log("Executing Tool:", tool);
            vscode.postMessage({
              type: tool.type,
              value: tool.value,
            });
          });

          // Clear buffer for the next turn
          streamBuffer.current = "";
          break;
        }
        
        case "updateAgents":
          // Handle agent list updates if needed
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleSend = () => {
    if (!input.trim()) return;

    // 1. Add User Message to UI
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    
    // 2. Send to Extension Backend
    // Note: You might want to pass the selected agentId here if you have a selector
    vscode.postMessage({ 
      type: "onPrompt", 
      value: input,
      agentId: "default-agent-id" // Replace with actual selected ID
    });

    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-container">
      <div className="messages-list">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-header">
              {msg.role === "user" ? "You" : "Agent"}
            </div>
            {/* Render content - You could use a Markdown renderer here */}
            <div className="message-content">
              {msg.content}
            </div>
          </div>
        ))}
        {isThinking && <div className="loading-indicator">Thinking...</div>}
      </div>

      <div className="input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask your agent to code..."
          rows={3}
        />
        <button onClick={handleSend} disabled={isThinking}>
          Send
        </button>
      </div>
    </div>
  );
};