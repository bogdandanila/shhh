import { expect, test, vi } from 'vitest';
import { Formatter, isSaneOutput, runFormatter } from '../src/core/formatter';

const raw = 'um so this is like a test of the the dictation system';

test('no formatter configured -> raw text, unformatted', async () => {
  const r = await runFormatter(null, raw);
  expect(r).toEqual({ text: raw, unformatted: true });
});

test('happy path uses formatter output', async () => {
  const f: Formatter = { format: async () => 'This is a test of the dictation system.' };
  const r = await runFormatter(f, raw);
  expect(r).toEqual({ text: 'This is a test of the dictation system.', unformatted: false });
});

test('one retry on failure, then fallback to raw', async () => {
  const format = vi.fn().mockRejectedValue(new Error('rate limit'));
  const r = await runFormatter({ format }, raw);
  expect(format).toHaveBeenCalledTimes(2);
  expect(r).toEqual({ text: raw, unformatted: true });
});

test('second attempt can succeed', async () => {
  const format = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('Clean text here.');
  const r = await runFormatter({ format }, raw);
  expect(r.unformatted).toBe(false);
  expect(r.text).toBe('Clean text here.');
});

test('insane output (empty / wild length) falls back to raw', async () => {
  expect(isSaneOutput(raw, '')).toBe(false);
  expect(isSaneOutput(raw, 'a'.repeat(raw.length * 5))).toBe(false);
  expect(isSaneOutput(raw, 'ok')).toBe(false); // < 20% of input length
  expect(isSaneOutput(raw, 'This is a test of the dictation system.')).toBe(true);
  const format = vi.fn().mockResolvedValue('');
  const r = await runFormatter({ format }, raw);
  expect(format).toHaveBeenCalledTimes(2);
  expect(r).toEqual({ text: raw, unformatted: true });
});
