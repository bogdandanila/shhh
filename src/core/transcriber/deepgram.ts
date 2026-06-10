import { AudioData } from '../../shared/types';
import { pcmToWav } from '../audio';
import { STT_TIMEOUT_MS, Transcriber } from './index';

export class DeepgramSTT implements Transcriber {
  constructor(private opts: { apiKey: string; model: string }) {}

  async transcribe(audio: AudioData): Promise<string> {
    const wavBuffer = pcmToWav(audio.pcm, audio.sampleRate);
    const res = await fetch(
      `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(this.opts.model)}&smart_format=true`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${this.opts.apiKey}`, 'Content-Type': 'audio/wav' },
        body: new Uint8Array(wavBuffer),
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Deepgram request failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { results: { channels: { alternatives: { transcript: string }[] }[] } };
    return json.results.channels[0]?.alternatives[0]?.transcript ?? '';
  }
}
