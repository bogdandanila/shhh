import { AudioData } from '../shared/types';
import { NewHistoryEntry } from './store';
import { Transcriber } from './transcriber';
import { Formatter, runFormatter } from './formatter';

export interface PipelineDeps {
  transcriber: Transcriber | null;
  formatter: Formatter | null;
  /** Returns false when injection failed but text is on the clipboard ("Copied — press ⌘V"). */
  paste(text: string): Promise<boolean>;
  saveHistory(entry: NewHistoryEntry): void;
  meta: { sttProvider: string; sttModel: string; llmProvider: string; llmModel: string };
}

export type CycleResult =
  | { ok: true; text: string; unformatted: boolean; pasted: boolean }
  | { ok: false; error: string };

const dbg = (...a: unknown[]): void => { if (process.env.SHHH_DEBUG) console.log('[shhh:pipeline]', ...a); };

/** One full dictation cycle. Principle: never lose the user's words. */
export async function runDictationCycle(audio: AudioData, deps: PipelineDeps): Promise<CycleResult> {
  if (!deps.transcriber) {
    return { ok: false, error: 'No speech-to-text configured. Run: shhh config set stt.provider …' };
  }
  let raw: string;
  const sttStart = Date.now();
  try {
    raw = (await deps.transcriber.transcribe(audio)).trim();
  } catch (e) {
    return { ok: false, error: `Transcription failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  dbg(`stt (${deps.meta.sttProvider}/${deps.meta.sttModel}): ${raw.length} chars in ${Date.now() - sttStart}ms`);
  if (!raw) return { ok: false, error: 'Nothing was transcribed' };

  const llmStart = Date.now();
  const { text, unformatted } = await runFormatter(deps.formatter, raw);
  dbg(unformatted
    ? 'formatter: skipped or fell back — pasting raw'
    : `formatter (${deps.meta.llmProvider}/${deps.meta.llmModel}): ${raw.length} → ${text.length} chars in ${Date.now() - llmStart}ms`);
  const pasted = await deps.paste(text);
  dbg(`paste: ${pasted ? 'injected' : 'clipboard fallback'}`);

  const durationMs = Math.round((audio.pcm.length / audio.sampleRate) * 1000);
  audio.pcm.fill(0); // spec: audio is memory-only and zeroed after transcription
  deps.saveHistory({
    rawText: raw, formattedText: text, unformatted,
    durationMs,
    sttProvider: deps.meta.sttProvider, sttModel: deps.meta.sttModel,
    llmProvider: unformatted ? 'none' : deps.meta.llmProvider,
    llmModel: unformatted ? '' : deps.meta.llmModel,
  });
  return { ok: true, text, unformatted, pasted };
}
