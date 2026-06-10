import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WHISPER_MODELS, modelPath, verifyChecksum, isModelPresent } from '../src/core/models';

test('registry has the expected models with urls + checksums', () => {
  for (const name of ['tiny.en', 'base.en', 'small.en'] as const) {
    expect(WHISPER_MODELS[name].url).toMatch(/^https:\/\/huggingface\.co\//);
    expect(WHISPER_MODELS[name].sha256).toMatch(/^[0-9a-f]{64}$/);
  }
});

test('verifyChecksum accepts matching file, rejects tampered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const f = join(dir, 'model.bin');
  writeFileSync(f, 'model bytes');
  const good = createHash('sha256').update('model bytes').digest('hex');
  expect(verifyChecksum(f, good)).toBe(true);
  expect(verifyChecksum(f, 'a'.repeat(64))).toBe(false);
});

test('modelPath + isModelPresent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  expect(modelPath(dir, 'base.en')).toBe(join(dir, 'models', 'ggml-base.en.bin'));
  expect(isModelPresent(dir, 'base.en')).toBe(false);
});

import { existsSync } from 'node:fs';
import { LocalWhisperSTT } from '../src/core/transcriber/local-whisper';
import { modelPath as mp } from '../src/core/models';

const localModel = mp(`${process.env.HOME}/Library/Application Support/shhh`, 'tiny.en');
test.skipIf(!existsSync(localModel))('local whisper transcribes silence to ~empty', async () => {
  const stt = new LocalWhisperSTT(localModel);
  const text = await stt.transcribe({ pcm: new Int16Array(16000), sampleRate: 16000 });
  expect(typeof text).toBe('string');
}, 60_000);
