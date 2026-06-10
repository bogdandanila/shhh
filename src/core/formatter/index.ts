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

/** One retry on failure/insanity, then fall back to raw — never lose the user's words. */
export async function runFormatter(f: Formatter | null, raw: string, timeoutMsFn = formatterTimeoutMs): Promise<FormatResult> {
  if (!f) return { text: raw, unformatted: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const out = await Promise.race([
          f.format(raw),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error('Formatter timeout')), timeoutMsFn(raw.length));
          }),
        ]);
        if (isSaneOutput(raw, out)) return { text: out.trim(), unformatted: false };
      } finally {
        clearTimeout(timer);
      }
    } catch { /* retry, then fall back */ }
  }
  return { text: raw, unformatted: true };
}
