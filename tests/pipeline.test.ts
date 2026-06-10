import { expect, test, vi } from 'vitest';
import { runDictationCycle, PipelineDeps } from '../src/core/pipeline';
import { AudioData } from '../src/shared/types';

const audio: AudioData = { pcm: new Int16Array(32000), sampleRate: 16000 };

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    transcriber: { transcribe: async () => 'um hello world' },
    formatter: { format: async () => 'Hello world.' },
    paste: vi.fn().mockResolvedValue(true),
    saveHistory: vi.fn(),
    meta: { sttProvider: 'local', sttModel: 'base.en', llmProvider: 'anthropic', llmModel: 'claude-haiku-4-5' },
    ...over,
  };
}

test('happy path: transcribe -> format -> paste -> history', async () => {
  const d = deps();
  const r = await runDictationCycle(audio, d);
  expect(r).toEqual({ ok: true, text: 'Hello world.', unformatted: false, pasted: true });
  expect(d.saveHistory).toHaveBeenCalledWith(expect.objectContaining({
    rawText: 'um hello world', formattedText: 'Hello world.', unformatted: false, durationMs: 2000,
  }));
});

test('no transcriber configured -> error, nothing pasted or saved', async () => {
  const d = deps({ transcriber: null });
  const r = await runDictationCycle(audio, d);
  expect(r).toEqual({ ok: false, error: 'No speech-to-text configured. Run: shhh config set stt.provider …' });
  expect(d.paste).not.toHaveBeenCalled();
  expect(d.saveHistory).not.toHaveBeenCalled();
});

test('STT throws -> error result with message, nothing pasted', async () => {
  const d = deps({ transcriber: { transcribe: async () => { throw new Error('401 bad key'); } } });
  const r = await runDictationCycle(audio, d);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain('401');
  expect(d.paste).not.toHaveBeenCalled();
});

test('empty transcription -> error, not saved', async () => {
  const d = deps({ transcriber: { transcribe: async () => '   ' } });
  const r = await runDictationCycle(audio, d);
  expect(r.ok).toBe(false);
});

test('formatter failure -> raw text pasted, marked unformatted', async () => {
  const d = deps({ formatter: { format: async () => { throw new Error('rate limit'); } } });
  const r = await runDictationCycle(audio, d);
  expect(r).toEqual({ ok: true, text: 'um hello world', unformatted: true, pasted: true });
  expect(d.saveHistory).toHaveBeenCalledWith(expect.objectContaining({ unformatted: true }));
});

test('paste failure -> still ok (text on clipboard), pasted=false, history saved', async () => {
  const d = deps({ paste: vi.fn().mockResolvedValue(false) });
  const r = await runDictationCycle(audio, d);
  expect(r).toEqual({ ok: true, text: 'Hello world.', unformatted: false, pasted: false });
  expect(d.saveHistory).toHaveBeenCalled();
});
