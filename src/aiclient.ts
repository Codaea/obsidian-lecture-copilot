export interface CustomChatCompletionResponse {
  id: string;
  object: string;
  created_at: number;
  status: string;
  model: string;
  output: Array<{
    type: string;
    id: string;
    status: string;
    role: string;
    content: Array<{
      type: string;
      text: string;
      annotations: any[];
    }>;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  // ...other fields as needed
}

export class AIClient {
    private endpoint: string;
    private apiKey: string;

    constructor(settings: { openAIKey: string, endpoint?: string }) {
        this.endpoint = 'https://api.openai.com';
        this.apiKey = settings.openAIKey;
    }

    async chatCompletion(model: string, messages: Array<{ role: string; content: string }>): Promise<string> {
        try {
            const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({ model, messages })
            });

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`OpenAI API error ${res.status} ${res.statusText}: ${body}`);
            }

            const data = await res.json().catch(() => null);

            const assistantText =
                data?.choices?.[0]?.message?.content ??
                data?.choices?.[0]?.message?.content?.[0]?.text ??
                data?.output?.[0]?.content?.[0]?.text ??
                '';

            console.log('AIClient.chatCompletion response:', data);
            return assistantText as string;
        } catch (err) {
            console.error('AIClient.chatCompletion error:', err);
            throw err;
        }
    }
}