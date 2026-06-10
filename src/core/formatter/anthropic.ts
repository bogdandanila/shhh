import Anthropic from '@anthropic-ai/sdk';
import { Formatter } from './index';

export class AnthropicFormatter implements Formatter {
  private client: Anthropic;
  constructor(apiKey: string, private model: string, private systemPrompt: string) {
    this.client = new Anthropic({ apiKey });
  }
  async format(raw: string): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: this.systemPrompt,
      messages: [{ role: 'user', content: raw }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
