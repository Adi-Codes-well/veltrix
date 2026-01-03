export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
  provider?: "openai" | "anthropic"; 
}

export interface ProjectTask {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'completed';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}