import { expect, test, vi } from 'vitest';
import { pasteWithClipboard, ClipboardLike } from '../src/main/paster';

function fakeClipboard(initial: string): ClipboardLike & { current: string } {
  const c = { current: initial, readText: () => c.current, writeText: (t: string) => { c.current = t; } };
  return c;
}

test('success: text pasted via keystroke, previous clipboard restored', async () => {
  const clip = fakeClipboard('previous content');
  const keystroke = vi.fn().mockResolvedValue(undefined);
  const ok = await pasteWithClipboard('new text', clip, keystroke, () => Promise.resolve());
  expect(ok).toBe(true);
  expect(keystroke).toHaveBeenCalled();
  expect(clip.current).toBe('previous content'); // restored
});

test('failure: keystroke throws -> returns false, text LEFT on clipboard', async () => {
  const clip = fakeClipboard('previous content');
  const keystroke = vi.fn().mockRejectedValue(new Error('not trusted'));
  const ok = await pasteWithClipboard('new text', clip, keystroke, () => Promise.resolve());
  expect(ok).toBe(false);
  expect(clip.current).toBe('new text'); // spec: "Copied — press ⌘V"
});
