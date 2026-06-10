import { AudioData } from '../../shared/types';
import { prepareUploads } from '../audio';
import { STT_TIMEOUT_MS, Transcriber } from './index';

export interface OpenAICompatibleOpts {
  apiKey: string;
  model: string;
  baseUrl: string;             // https://api.openai.com/v1 | https://api.groq.com/openai/v1
  maxUploadBytes?: number;     // default 24MB (OpenAI limit is 25MB)
}

export class OpenAICompatibleSTT implements Transcriber {
  constructor(private opts: OpenAICompatibleOpts) {}

  async transcribe(audio: AudioData): Promise<string> {
    const parts = prepareUploads(audio.pcm, audio.sampleRate, this.opts.maxUploadBytes ?? 24 * 1024 * 1024);
    const texts: string[] = [];
    for (const part of parts) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(part.data)], { type: part.mime }), part.filename);
      form.append('model', this.opts.model);
      const res = await fetch(`${this.opts.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`STT request failed (${res.status}): ${await res.text()}`);
      texts.push(((await res.json()) as { text: string }).text.trim());
    }
    return texts.join(' ');
  }
}
