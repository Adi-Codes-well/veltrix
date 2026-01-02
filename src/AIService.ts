import OpenAI from 'openai';

export class AIService {
    private openai: OpenAI;
    private systemPrompt: string;
    private model: string;

    constructor(apiKey: string, systemPrompt: string, model: string) {
        this.systemPrompt = systemPrompt;
        this.model = model;

        // 🟢 FIX 1: Trim whitespace to prevent " csk-" errors
        const cleanKey = apiKey.trim();

        let baseURL = undefined; // Default (OpenAI)
        let defaultHeaders = undefined;

        // Case 1: OpenRouter
        if (cleanKey.startsWith('sk-or-v1')) {
            baseURL = "https://openrouter.ai/api/v1";
            defaultHeaders = {
                "HTTP-Referer": "https://github.com/veltrix", 
                "X-Title": "Veltrix"                          
            };
        } 
        // Case 2: Google Gemini
        else if (cleanKey.startsWith('AIza')) {
            baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
        }
        // 🟢 Case 3: Cerebras
        else if (cleanKey.startsWith('csk-')) {
            baseURL = "https://api.cerebras.ai/v1";
        }

        // 🟢 FIX 2: Debug Log (Check the "Debug Console" in VS Code to see this)
        console.log(`[Veltrix] Initializing AI with BaseURL: ${baseURL || "Default OpenAI"}`);

        // Initialize OpenAI Client
        this.openai = new OpenAI({ 
            apiKey: cleanKey, // Use the trimmed key
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
                model: this.model, 
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
            // Log the full error to help debug
            console.error("AI Service Error:", error);
            throw new Error(`AI Error: ${error}`);
        }
    }
}