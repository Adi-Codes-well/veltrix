import { useState, useEffect, useRef } from "react";
import { vscode } from "./utilities/vscode";
import "./App.css";

// Define the Agent shape (must match the backend!)
type AgentConfig = {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
};

type Message = { role: "user" | "assistant"; content: string };

function App() {
  // --- STATE MANAGEMENT ---
  const [view, setView] = useState<"chat" | "settings">("chat"); // Toggle screens
  const [agents, setAgents] = useState<AgentConfig[]>([]); // List of available agents
  const [activeAgentId, setActiveAgentId] = useState<string>(""); // Currently selected agent

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Form State (for creating new agents)
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    systemPrompt: "You are a helpful coding assistant.",
    model: "gpt-4o", // Default model
    apiKey: "",
  });

  const bottomRef = useRef<HTMLDivElement>(null);

  // --- EVENT HANDLERS ---

  // 1. Listen for messages from the Backend (Extension)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        // 🟢 Case A: Receive list of agents from backend
        case "updateAgents":
          setAgents(message.value);
          // If no agent selected yet, select the first one
          if (!activeAgentId && message.value.length > 0) {
            setActiveAgentId(message.value[0].id);
          }
          break;

        // 🟢 Case B: Chat streaming
        case "onToken":
          setMessages((prev) => {
            const newHistory = [...prev];
            const lastMsg = newHistory[newHistory.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              lastMsg.content += message.value;
              return newHistory;
            } else {
              return [...prev, { role: "assistant", content: message.value }];
            }
          });
          break;

        case "onComplete":
          setIsLoading(false);
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    // 🟢 Ask backend for agents when app loads
    vscode.postMessage({ type: "getAgents" });

    return () => window.removeEventListener("message", handleMessage);
  }, [activeAgentId]); // Re-run if activeAgentId changes (optional but safe)

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 2. Send Chat Message
  const sendMessage = () => {
    if (!input.trim()) return;
    if (!activeAgentId) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ Please create and select an agent first!",
        },
      ]);
      return;
    }

    // UI Updates
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setIsLoading(true);
    setInput("");

    // 🟢 Send to Backend with Agent ID
    vscode.postMessage({
      type: "onPrompt", // CHANGED: from 'command: chat' to 'type: onPrompt'
      value: input,
      agentId: activeAgentId,
    });
  };

  // 3. Save New Agent
  const handleSaveAgent = () => {
    const newAgent: AgentConfig = {
      id: Date.now().toString(), // Simple ID generation
      name: formData.name,
      role: formData.role,
      systemPrompt: formData.systemPrompt,
      model: formData.model,
    };

    // 🟢 Send to Backend (Config + API Key separately)
    vscode.postMessage({
      type: "saveAgent",
      value: newAgent,
      apiKey: formData.apiKey,
    });

    // Switch back to chat and clear sensitive key from memory
    setFormData({ ...formData, apiKey: "" }); // Clear key
    setView("chat");
  };

  // 🟢 Helper to parse AI messages and render buttons
  const renderMessageContent = (
    content: string,
    role: "user" | "assistant"
  ) => {
    if (role === "user") return content;

    // Regex to find <execute_command>...</execute_command>
    const cmdMatch = content.match(
      /<execute_command>(.*?)<\/execute_command>/s
    );
    if (cmdMatch) {
      const cmd = cmdMatch[1].trim();
      return (
        <div className="action-box">
          <p>⚡ Suggests Command:</p>
          <code>{cmd}</code>
          <button
            className="run-btn"
            onClick={() =>
              vscode.postMessage({ type: "executeCommand", value: cmd })
            }
          >
            Run Command
          </button>
        </div>
      );
    }

    // Regex to find <write_file path="...">...</write_file>
    const fileMatch = content.match(
      /<write_file path="(.*?)">(.*?)<\/write_file>/s
    );
    if (fileMatch) {
      const filePath = fileMatch[1];
      const fileContent = fileMatch[2];
      return (
        <div className="action-box">
          <p>📝 Suggests Edit: {filePath}</p>
          <button
            className="diff-btn"
            onClick={() =>
              vscode.postMessage({
                type: "requestDiff",
                value: { path: filePath, content: fileContent },
              })
            }
          >
            Review Changes
          </button>
        </div>
      );
    }

    // Default: Just return text
    return content;
  };

  // --- RENDER ---
  return (
    <div className="container">
      {/* 🟢 Navigation Tabs */}
      <div className="tabs">
        <button
          className={view === "chat" ? "active" : ""}
          onClick={() => setView("chat")}
        >
          Chat
        </button>
        <button
          className={view === "settings" ? "active" : ""}
          onClick={() => setView("settings")}
        >
          + New Agent
        </button>
      </div>

      {/* 🟢 VIEW 1: SETTINGS FORM */}
      {view === "settings" && (
        <div className="settings-form">
          <h3>Create New Specialist</h3>
          <input
            placeholder="Agent Name (e.g., Senior Backend)"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <input
            placeholder="Role (e.g., Python Expert)"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
          />
          <select
            value={formData.model}
            onChange={(e) =>
              setFormData({ ...formData, model: e.target.value })
            }
          >
            <option value="gpt-4o">GPT-4o (OpenAI)</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Google)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Google)</option>
            <option value="google/gemini-2.0-flash-exp:free">
              Gemini Free (OpenRouter)
            </option>
          </select>
          <textarea
            placeholder="System Prompt (Instructions)"
            value={formData.systemPrompt}
            onChange={(e) =>
              setFormData({ ...formData, systemPrompt: e.target.value })
            }
            rows={4}
          />
          <input
            type="password"
            placeholder="API Key (Saved Securely)"
            value={formData.apiKey}
            onChange={(e) =>
              setFormData({ ...formData, apiKey: e.target.value })
            }
          />
          <button onClick={handleSaveAgent}>Save Agent</button>
        </div>
      )}

      {/* 🟢 VIEW 2: CHAT INTERFACE */}
      {view === "chat" && (
        <>
          <div className="agent-selector">
            <label>Talking to: </label>
            <select
              value={activeAgentId}
              onChange={(e) => setActiveAgentId(e.target.value)}
              disabled={agents.length === 0}
            >
              {agents.length === 0 && <option>No agents created</option>}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.role})
                </option>
              ))}
            </select>
          </div>

          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                {/* 🟢 Call the helper function here */}
                {renderMessageContent(m.content, m.role)}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="input-area">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button onClick={sendMessage} disabled={isLoading}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
