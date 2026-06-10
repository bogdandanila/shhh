import OpenAI from 'openai';
import { Formatter } from './index';

export class OpenAIFormatter implements Formatter {
  private client: OpenAI;
  constructor(apiKey: string, private model: string, private systemPrompt: string) {
    this.client = new OpenAI({ apiKey });
  }
  async format(raw: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: raw },
      ],
    });
    return res.choices[0]?.message?.content ?? '';
  }
}
