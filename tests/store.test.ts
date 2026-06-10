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

  // Fix 1: defensive key validation
  test('constructor throws on invalid hex key', () => {
    expect(() => new ShhhStore(join(dir(), 'db'), 'not-hex')).toThrow(/Invalid DB key/);
  });

  // Fix 2: getHistoryById SQL fast/slow path
  test('getHistoryById returns entry by exact id', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    const e = s.insertHistory({ rawText: 'exact', formattedText: 'Exact.', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: false });
    expect(s.getHistoryById(e.id)).not.toBeNull();
    expect(s.getHistoryById(e.id)!.rawText).toBe('exact');
    s.close();
  });

  test('getHistoryById returns entry by 8-char prefix', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    const e = s.insertHistory({ rawText: 'prefix', formattedText: 'Prefix.', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: false });
    const prefix = e.id.slice(0, 8);
    expect(s.getHistoryById(prefix)).not.toBeNull();
    expect(s.getHistoryById(prefix)!.rawText).toBe('prefix');
    s.close();
  });

  test('getHistoryById returns null for tombstoned entry', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    const e = s.insertHistory({ rawText: 'gone', formattedText: 'Gone.', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: false });
    s.clearHistory();
    expect(s.getHistoryById(e.id)).toBeNull();
    s.close();
  });

  test('getHistoryById returns null for unknown id', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    expect(s.getHistoryById('00000000-0000-0000-0000-000000000000')).toBeNull();
    s.close();
  });

  test('wipeHistory physically deletes all rows including tombstones', () => {
    const s = new ShhhStore(join(dir(), 'db'), key());
    s.insertHistory({ rawText: 'a', formattedText: 'A.', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
    s.insertHistory({ rawText: 'b', formattedText: 'B.', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
    // tombstone one row so it won't appear in listHistory
    s.clearHistory();
    // countAllForTest should still see 2 (tombstoned rows exist)
    expect(s.countAllForTest()).toBe(2);
    // now physically wipe
    s.wipeHistory();
    expect(s.countAllForTest()).toBe(0);
    // and listHistory is also empty
    expect(s.listHistory({ limit: 10 })).toHaveLength(0);
    // inserting after wipe: only the new row
    s.insertHistory({ rawText: 'new', formattedText: 'New.', sttProvider: 'local', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: false });
    expect(s.countAllForTest()).toBe(1);
    s.close();
  });
});
