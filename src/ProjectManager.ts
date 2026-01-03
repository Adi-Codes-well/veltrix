import * as vscode from 'vscode';
import { ProjectTask, ChatMessage } from './types';

export class ProjectManager {
    private history: ChatMessage[] = [];
    private plan: ProjectTask[] = [];
    
    // We can use this to track which files are being worked on
    private activeFiles: Set<string> = new Set();

    constructor(private readonly context: vscode.ExtensionContext) {
        // Future: Load state from context.globalState or workspaceState here
    }

    public addMessage(role: 'user' | 'assistant' | 'system', content: string) {
        this.history.push({
            role,
            content,
            timestamp: Date.now()
        });
        
        // Keep history manageable (e.g., last 50 messages)
        if (this.history.length > 50) {
            this.history.shift();
        }
    }

    public getHistory(): ChatMessage[] {
        return this.history;
    }

    public updatePlan(newPlan: ProjectTask[]) {
        this.plan = newPlan;
    }

    public getPlan(): ProjectTask[] {
        return this.plan;
    }

    // This generates the "Shared Brain" context block
    public getContextPrompt(): string {
        const pendingTasks = this.plan.filter(t => t.status === 'pending').map(t => `- ${t.title}`).join('\n');
        const activeTask = this.plan.find(t => t.status === 'active')?.title || "None";
        
        // We only summarize the last few messages to avoid token overflow
        const recentHistory = this.history.slice(-5).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

        return `
[PROJECT STATE]
Active Task: ${activeTask}
Pending Tasks:
${pendingTasks || "No pending tasks."}

[RECENT HISTORY]
${recentHistory}
`;
    }
}