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

/** One retry on failure/insanity, then fall back to raw — never lose the user's words. */
export async function runFormatter(f: Formatter | null, raw: string): Promise<FormatResult> {
  if (!f) return { text: raw, unformatted: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await f.format(raw);
      if (isSaneOutput(raw, out)) return { text: out.trim(), unformatted: false };
    } catch { /* retry, then fall back */ }
  }
  return { text: raw, unformatted: true };
}
