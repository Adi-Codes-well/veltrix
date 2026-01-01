import OpenAI from 'openai';

export class AIService {
    private openai: OpenAI;

    constructor(apiKey: string) {
        // In a real app, never hardcode this. Use vscode.workspace.getConfiguration
        this.openai = new OpenAI({ apiKey: apiKey });
    }

    async *streamChat(prompt: string, currentCodeContext?: string) {
        const systemMessage = "You are a specialized coding assistant for VS Code.";
        const fullPrompt = currentCodeContext 
            ? `Context (Current File):\n\`\`\`\n${currentCodeContext}\n\`\`\`\n\nUser Question: ${prompt}`
            : prompt;

        try {
            const stream = await this.openai.chat.completions.create({
                model: 'gpt-4o', // or 'gpt-3.5-turbo'
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: fullPrompt }
                ],
                stream: true,
            });

            // Yield chunks as they arrive
            for await (const chunk of stream) {
                yield chunk.choices[0]?.delta?.content || "";
            }
        } catch (error) {
            throw new Error(`AI Error: ${error}`);
        }
    }
}