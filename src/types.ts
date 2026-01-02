export interface AgentConfig {
  id: string;
  name: string;
  role: string; // e.g., "Frontend Dev", "QA"
  systemPrompt: string;
  model: string; // "gpt-4o", "gpt-3.5-turbo"
  provider: "openai" | "anthropic"; // Prepare for future expansion
}

// We don't store the API key in the config object to avoid leaking it in logs
// API Keys will be stored in SecretStorage mapped by agent.id