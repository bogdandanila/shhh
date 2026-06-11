import { beforeEach, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildHandlers, HandlerDeps } from '../src/core/rpc-handlers';
import { ShhhStore } from '../src/core/store';
import { InMemoryApiKeyStore } from '../src/core/api-keys';
import { DEFAULT_SYSTEM_PROMPT } from '../src/core/formatter/default-prompt';

let deps: HandlerDeps;
let h: ReturnType<typeof buildHandlers>;

beforeEach(() => {
  deps = {
    store: new ShhhStore(join(mkdtempSync(join(tmpdir(), 'shhh-')), 'db'), randomBytes(32).toString('hex')),
    apiKeys: new InMemoryApiKeyStore(),
    dataDir: mkdtempSync(join(tmpdir(), 'shhh-')),
    checkPermissions: async () => ({ microphone: true, accessibility: false }),
    appVersion: '0.1.0',
  };
  h = buildHandlers(deps);
});

test('config.set/get with secret redaction', async () => {
  await h['config.set']({ key: 'stt.provider', value: 'openai' });
  await h['config.set']({ key: 'openai.api-key', value: 'sk-proj-abcdefgh1234' });
  const cfg = (await h['config.get']({})) as Record<string, string>;
  expect(cfg['stt.provider']).toBe('openai');
  expect(cfg['openai.api-key']).toBe('sk-proj…1234');     // redacted
  expect(deps.apiKeys.get('openai')).toBe('sk-proj-abcdefgh1234'); // stored for real
});

test('config.set validates durations and providers', async () => {
  await h['config.set']({ key: 'max-recording', value: '30m' });
  expect(deps.store.getSettings().maxRecordingMs).toBe(1_800_000);
  await expect(h['config.set']({ key: 'stt.provider', value: 'bogus' })).rejects.toThrow();
});

test('prompt.get/set/reset', async () => {
  expect(await h['prompt.get']({})).toBe(DEFAULT_SYSTEM_PROMPT);
  await h['prompt.set']({ prompt: 'Custom prompt here' });
  expect(await h['prompt.get']({})).toBe('Custom prompt here');
  await h['prompt.reset']({});
  expect(await h['prompt.get']({})).toBe(DEFAULT_SYSTEM_PROMPT);
});

test('history.list / history.get / history.clear', async () => {
  deps.store.insertHistory({ rawText: 'a', formattedText: 'A.', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
  const list = (await h['history.list']({ limit: 5 })) as { id: string }[];
  expect(list).toHaveLength(1);
  expect(((await h['history.get']({ id: list[0].id })) as { formattedText: string }).formattedText).toBe('A.');
  await h['history.clear']({});
  expect(await h['history.list']({ limit: 5 })).toEqual([]);
});

test('status and doctor report configuration state', async () => {
  const status = (await h.status({})) as Record<string, unknown>;
  expect(status).toMatchObject({ version: '0.1.0', sttConfigured: false, llmConfigured: false });
  const doc = (await h.doctor({})) as Record<string, unknown>;
  expect(doc).toMatchObject({ microphone: true, accessibility: false });
});

test('config.get rejects unknown keys', async () => {
  await expect(h['config.get']({ key: 'bogus' })).rejects.toThrow(/unknown config key/i);
});

test('config.get returns empty string for known key with no value set (e.g. api key)', async () => {
  const result = (await h['config.get']({ key: 'openai.api-key' })) as Record<string, string>;
  expect(result['openai.api-key']).toBe('');
});

test('nuke wipes settings, history, and keys', async () => {
  deps.apiKeys.set('anthropic', 'k');
  deps.store.insertHistory({ rawText: 'x', formattedText: 'x', sttProvider: '', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
  await h.nuke({});
  expect(deps.apiKeys.providersWithKeys()).toEqual([]);
  expect(await h['history.list']({ limit: 5 })).toEqual([]);
});

test('config.set/get round-trips duck-audio as on/off', async () => {
  const before = (await h['config.get']({ key: 'duck-audio' })) as Record<string, string>;
  expect(before['duck-audio']).toBe('on'); // default
  await h['config.set']({ key: 'duck-audio', value: 'off' });
  expect(deps.store.getSettings().duckAudio).toBe(false);
  const after = (await h['config.get']({ key: 'duck-audio' })) as Record<string, string>;
  expect(after['duck-audio']).toBe('off');
});

test('nuke resets duckAudio to default (on)', async () => {
  await h['config.set']({ key: 'duck-audio', value: 'off' });
  await h.nuke({});
  expect(deps.store.getSettings().duckAudio).toBe(true);
});

test('nuke hard-deletes history rows (not just tombstones) and resets hotkey/maxRecordingMs to defaults', async () => {
  await h['config.set']({ key: 'hotkey', value: '99' });
  await h['config.set']({ key: 'max-recording', value: '30m' });
  deps.store.insertHistory({ rawText: 'x', formattedText: 'x', sttProvider: '', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
  await h.nuke({});
  const settings = deps.store.getSettings();
  expect(settings.hotkey).toBe('fn');
  expect(settings.maxRecordingMs).toBe(600_000);
  // history rows physically deleted
  expect(deps.store.countAllForTest()).toBe(0);
});
