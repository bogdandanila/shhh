import { AudioData } from '../../shared/types';
import { Transcriber } from './index';

const dbg = (...a: unknown[]): void => { if (process.env.SHHH_DEBUG) console.log('[shhh:stt]', ...a); };

/**
 * Whisper emits annotations like "[BLANK_AUDIO]" or "(music)" for non-speech
 * audio (e.g. the trailing silence before the hotkey is released). We ask
 * whisper.cpp to suppress them, but that's best-effort — pure-silence segments
 * still slip through, so segments that are *only* an annotation get dropped.
 */
export function isNonSpeechSegment(text: string): boolean {
  return /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/.test(text);
}

/**
 * Whisper is trained heavily on video subtitles, so on trailing/leading silence
 * it hallucinates the pleasantries those videos end with ("thank you", "thanks
 * for watching", "please subscribe"). These get real tokens, so suppression
 * flags don't catch them — we strip them from the ENDS of the transcript only,
 * and only when token confidence is low. A genuinely-spoken "Thank you." (e.g.
 * ending a dictated email) scores high confidence and survives.
 */
const HALLUCINATION_PHRASES = new Set([
  'thank you', 'thanks', 'thank you very much', 'thank you so much',
  'thanks for watching', 'thank you for watching', 'thanks for watching!',
  'please subscribe', 'subscribe', 'bye', 'bye bye', 'you',
]);

// smart-whisper confidence is the average token probability (0–1).
export const HALLUCINATION_CONFIDENCE = 0.6;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

export function isLikelyHallucination(text: string, confidence: number | undefined): boolean {
  if (!HALLUCINATION_PHRASES.has(normalize(text))) return false;
  // No confidence available → can't distinguish genuine speech; strip to honor the fix.
  return confidence === undefined || confidence < HALLUCINATION_CONFIDENCE;
}

export interface WhisperSegment { text: string; confidence?: number }

export function cleanTranscript(segments: WhisperSegment[]): string {
  let segs = segments.filter((s) => !isNonSpeechSegment(s.text));
  while (segs.length && isLikelyHallucination(segs[0].text, segs[0].confidence)) {
    dbg(`dropped leading hallucination: "${segs[0].text.trim()}" (conf ${segs[0].confidence?.toFixed(2) ?? 'n/a'})`);
    segs = segs.slice(1);
  }
  while (segs.length && isLikelyHallucination(segs[segs.length - 1].text, segs[segs.length - 1].confidence)) {
    const s = segs[segs.length - 1];
    dbg(`dropped trailing hallucination: "${s.text.trim()}" (conf ${s.confidence?.toFixed(2) ?? 'n/a'})`);
    segs = segs.slice(0, -1);
  }
  return segs.map((s) => s.text).join('').trim();
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
      // 'detail' format yields per-segment confidence, used to spot silence hallucinations.
      const task = await whisper.transcribe(f32, { language: 'en', suppress_non_speech_tokens: true, format: 'detail' });
      const segments = (await task.result) as WhisperSegment[];
      if (process.env.SHHH_DEBUG) {
        for (const s of segments) dbg(`segment: "${s.text.trim()}" (conf ${s.confidence?.toFixed(2) ?? 'n/a'})`);
      }
      return cleanTranscript(segments);
    } finally {
      await whisper.free();
    }
  }
}
