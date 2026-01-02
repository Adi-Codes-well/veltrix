import OpenAI from 'openai';

export class AIService {
    private openai: OpenAI;
    private systemPrompt: string;
    private model: string;

    // 🟢 Updated Constructor: Accepts 3 arguments (Key, Prompt, Model)
    constructor(apiKey: string, systemPrompt: string, model: string) {
        this.systemPrompt = systemPrompt;
        this.model = model;

        // 🟢 SMART LOGIC: Check if the key belongs to OpenRouter
        let baseURL = undefined; // Default (OpenAI)
        let defaultHeaders = undefined;

        // Case 1: OpenRouter (Key starts with 'sk-or-v1')
        if (apiKey.startsWith('sk-or-v1')) {
            baseURL = "https://openrouter.ai/api/v1";
            defaultHeaders = {
                "HTTP-Referer": "https://github.com/veltrix", // Required by OpenRouter
                "X-Title": "Veltrix"                          // Required by OpenRouter
            };
        } 
        // Case 2: Google Gemini (Key starts with 'AIza')
        else if (apiKey.startsWith('AIza')) {
            baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
        }

        // Initialize OpenAI Client with the correct URL
        this.openai = new OpenAI({ 
            apiKey: apiKey,
            baseURL: baseURL,
            defaultHeaders: defaultHeaders
        });
    }

    async *streamChat(userPrompt: string, currentCodeContext?: string) {
        const fullPrompt = currentCodeContext 
            ? `Context:\n\`\`\`\n${currentCodeContext}\n\`\`\`\n\nQuestion: ${userPrompt}`
            : userPrompt;

        try {
            const stream = await this.openai.chat.completions.create({
                model: this.model, // 🟢 Use the dynamic model (e.g., gemini-2.0-flash-exp:free)
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: fullPrompt }
                ],
                stream: true,
            });

            for await (const chunk of stream) {
                yield chunk.choices[0]?.delta?.content || "";
            }
        } catch (error) {
            throw new Error(`AI Error: ${error}`);
        }
    }
}