import { AudioData } from '../../shared/types';
import { Transcriber } from './index';

/** whisper.cpp via smart-whisper. Loaded lazily so the app runs without the native module. */
export class LocalWhisperSTT implements Transcriber {
  constructor(private modelFile: string) {}

  async transcribe(audio: AudioData): Promise<string> {
    const { Whisper } = await import('smart-whisper');
    const whisper = new Whisper(this.modelFile, { gpu: true });
    try {
      const f32 = new Float32Array(audio.pcm.length);
      for (let i = 0; i < audio.pcm.length; i++) f32[i] = audio.pcm[i] / 32768;
      const task = await whisper.transcribe(f32, { language: 'en' });
      const segments = await task.result;
      return segments.map((s: { text: string }) => s.text).join('').trim();
    } finally {
      await whisper.free();
    }
  }
}
