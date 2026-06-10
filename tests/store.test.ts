import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ShhhStore } from '../src/core/store';

const key = () => randomBytes(32).toString('hex');
const dir = () => mkdtempSync(join(tmpdir(), 'shhh-'));

describe('ShhhStore', () => {
  test('initializes settings with defaults and a generated deviceId', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    const settings = s.getSettings();
    expect(settings.sttProvider).toBe('unset');
    expect(settings.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    s.close();
  });

  test('settings round-trip', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    s.patchSettings({ sttProvider: 'local', sttModel: 'base.en' });
    expect(s.getSettings().sttModel).toBe('base.en');
    s.close();
  });

  test('history insert/list, search, tombstone clear', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    s.insertHistory({ rawText: 'um hello world', formattedText: 'Hello world.', sttProvider: 'local', sttModel: 'base.en', llmProvider: 'anthropic', llmModel: 'claude-haiku-4-5', durationMs: 1200, unformatted: false });
    s.insertHistory({ rawText: 'foo', formattedText: 'Foo.', sttProvider: 'local', sttModel: 'base.en', llmProvider: 'none', llmModel: '', durationMs: 300, unformatted: true });
    expect(s.listHistory({ limit: 10 })).toHaveLength(2);
    expect(s.listHistory({ limit: 10, search: 'hello' })).toHaveLength(1);
    expect(s.listHistory({ limit: 10 })[0].formattedText).toBe('Foo.'); // newest first
    s.clearHistory();
    expect(s.listHistory({ limit: 10 })).toHaveLength(0);
    s.close();
  });

  test('ids are UUIDv7 (time-ordered)', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    const e = s.insertHistory({ rawText: 'x', formattedText: 'x', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
    expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    s.close();
  });

  test('reopening with the same key works; wrong key throws', () => {
    const d = join(dir(), 'db');
    const k = key();
    const s1 = new ShhhStore(d, k);
    s1.patchSettings({ sttModel: 'persisted' });
    s1.close();
    const s2 = new ShhhStore(d, k);
    expect(s2.getSettings().sttModel).toBe('persisted');
    s2.close();
    expect(() => new ShhhStore(d, key())).toThrow();
  });

  test('purgeOldHistory respects retention', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    const e = s.insertHistory({ rawText: 'old', formattedText: 'old', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
    s.backdateForTest(e.id, new Date(Date.now() - 40 * 86_400_000).toISOString());
    s.purgeOldHistory(30 * 86_400_000);
    expect(s.listHistory({ limit: 10 })).toHaveLength(0);
    s.close();
  });
});
