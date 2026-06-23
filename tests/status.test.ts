import { expect, test } from 'vitest';
import { isSttConfigured, isLlmConfigured, buildAppStatus } from '../src/core/status';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { Settings } from '../src/shared/types';

const s = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

test('isSttConfigured: unset provider is never configured', () => {
  expect(isSttConfigured(s({ sttProvider: 'unset', sttModel: '' }), { modelPresent: true, keyPresent: true })).toBe(false);
});

test('isSttConfigured: local needs the model file present', () => {
  expect(isSttConfigured(s({ sttProvider: 'local', sttModel: 'base.en' }), { modelPresent: true, keyPresent: false })).toBe(true);
  expect(isSttConfigured(s({ sttProvider: 'local', sttModel: 'base.en' }), { modelPresent: false, keyPresent: true })).toBe(false);
});

test('isSttConfigured: cloud needs an API key and a model', () => {
  expect(isSttConfigured(s({ sttProvider: 'openai', sttModel: 'whisper-1' }), { modelPresent: false, keyPresent: true })).toBe(true);
  expect(isSttConfigured(s({ sttProvider: 'openai', sttModel: 'whisper-1' }), { modelPresent: false, keyPresent: false })).toBe(false);
  expect(isSttConfigured(s({ sttProvider: 'openai', sttModel: '' }), { modelPresent: false, keyPresent: true })).toBe(false);
});

test('isLlmConfigured: none is never configured; set needs model+key', () => {
  expect(isLlmConfigured(s({ llmProvider: 'none', llmModel: '' }), { keyPresent: true })).toBe(false);
  expect(isLlmConfigured(s({ llmProvider: 'anthropic', llmModel: 'claude-haiku-4-5' }), { keyPresent: true })).toBe(true);
  expect(isLlmConfigured(s({ llmProvider: 'anthropic', llmModel: 'claude-haiku-4-5' }), { keyPresent: false })).toBe(false);
  expect(isLlmConfigured(s({ llmProvider: 'anthropic', llmModel: '' }), { keyPresent: true })).toBe(false);
});

test('buildAppStatus: ready requires both permissions and STT', () => {
  const base = {
    settings: s({ sttProvider: 'local', sttModel: 'base.en', llmProvider: 'none', llmModel: '' }),
    version: '0.3.1',
    sttModelPresent: true, sttKeyPresent: false, llmKeyPresent: false,
  };
  expect(buildAppStatus({ ...base, permissions: { microphone: true, accessibility: true } }).ready).toBe(true);
  expect(buildAppStatus({ ...base, permissions: { microphone: true, accessibility: false } }).ready).toBe(false);
  const out = buildAppStatus({ ...base, permissions: { microphone: true, accessibility: true } });
  expect(out.stt.configured).toBe(true);
  expect(out.llm.configured).toBe(false);
  expect(out.version).toBe('0.3.1');
  expect(out.hotkey).toBe('fn');
});
