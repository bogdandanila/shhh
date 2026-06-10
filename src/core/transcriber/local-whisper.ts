import { AudioData } from '../../shared/types';
import { Transcriber } from './index';

/**
 * Whisper emits annotations like "[BLANK_AUDIO]" or "(music)" for non-speech
 * audio (e.g. the trailing silence before the hotkey is released). We ask
 * whisper.cpp to suppress them, but that's best-effort — pure-silence segments
 * still slip through, so segments that are *only* an annotation get dropped.
 */
export function isNonSpeechSegment(text: string): boolean {
  return /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/.test(text);
}

/** whisper.cpp via smart-whisper. Loaded lazily so the app runs without the native module. */
export class LocalWhisperSTT implements Transcriber {
  constructor(private modelFile: string) {}

  async transcribe(audio: AudioData): Promise<string> {
    const { Whisper } = await import('smart-whisper');
    const whisper = new Whisper(this.modelFile, { gpu: true });
    try {
      const f32 = new Float32Array(audio.pcm.length);
      for (let i = 0; i < audio.pcm.length; i++) f32[i] = audio.pcm[i] / 32768;
      const task = await whisper.transcribe(f32, { language: 'en', suppress_non_speech_tokens: true });
      const segments = await task.result;
      return segments
        .map((s: { text: string }) => s.text)
        .filter((t: string) => !isNonSpeechSegment(t))
        .join('').trim();
    } finally {
      await whisper.free();
    }
  }
}
