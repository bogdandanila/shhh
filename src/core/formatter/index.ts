export interface Formatter {
  format(raw: string): Promise<string>;
}

/** Reject empty output and wild length changes (LLM refusals, runaway generations). */
export function isSaneOutput(raw: string, out: string): boolean {
  const t = out.trim();
  if (!t) return false;
  const ratio = t.length / Math.max(raw.trim().length, 1);
  return ratio >= 0.2 && ratio <= 3;
}

export interface FormatResult { text: string; unformatted: boolean }

/** Baseline 15s + 1s per 500 chars of input — dictation is interactive; raw-and-fast beats perfect-and-late. */
export function formatterTimeoutMs(rawLength: number): number {
  return 15_000 + Math.ceil(rawLength / 500) * 1_000;
}

const dbg = (...a: unknown[]): void => { if (process.env.SHHH_DEBUG) console.log('[shhh:llm]', ...a); };

/** One retry on failure/insanity, then fall back to raw — never lose the user's words. */
export async function runFormatter(f: Formatter | null, raw: string, timeoutMsFn = formatterTimeoutMs): Promise<FormatResult> {
  if (!f) {
    dbg('no formatter configured — pasting raw transcription');
    return { text: raw, unformatted: true };
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        dbg(`attempt ${attempt}/2 — in: ${raw.length} chars, timeout: ${timeoutMsFn(raw.length)}ms`);
        const out = await Promise.race([
          f.format(raw),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error('Formatter timeout')), timeoutMsFn(raw.length));
          }),
        ]);
        if (isSaneOutput(raw, out)) {
          dbg(`ok in ${Date.now() - started}ms — out: ${out.trim().length} chars`);
          return { text: out.trim(), unformatted: false };
        }
        // Never silent: a discarded LLM response should be explainable after the fact.
        console.warn(`[shhh:llm] attempt ${attempt}/2: output failed sanity check (in ${raw.length} chars → out ${out.trim().length}), ${attempt < 2 ? 'retrying' : 'falling back to raw'}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.warn(`[shhh:llm] attempt ${attempt}/2 failed after ${Date.now() - started}ms: ${e instanceof Error ? e.message : e} — ${attempt < 2 ? 'retrying' : 'falling back to raw'}`);
    }
  }
  return { text: raw, unformatted: true };
}
