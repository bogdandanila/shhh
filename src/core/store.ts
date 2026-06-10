import Database from 'better-sqlite3-multiple-ciphers';
import { randomUUID } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { HistoryEntry, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from './settings';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,            -- UUIDv7 (sync-ready)
  raw_text TEXT NOT NULL,
  formatted_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,                -- tombstone (sync-ready)
  device_id TEXT NOT NULL,
  stt_provider TEXT NOT NULL, stt_model TEXT NOT NULL,
  llm_provider TEXT NOT NULL, llm_model TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  unformatted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
`;

export type NewHistoryEntry = Pick<HistoryEntry,
  'rawText' | 'formattedText' | 'sttProvider' | 'sttModel' | 'llmProvider' | 'llmModel' | 'durationMs' | 'unformatted'>;

export class ShhhStore {
  private db: Database.Database;

  constructor(dbPath: string, hexKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('Invalid DB key format');
    this.db = new Database(dbPath);
    this.db.pragma(`cipher='sqlcipher'`);
    this.db.pragma(`key="x'${hexKey}'"`);
    this.db.exec(SCHEMA); // throws "file is not a database" on wrong key
    if (!this.rawGet('deviceId')) this.rawSet('deviceId', JSON.stringify(randomUUID()));
  }

  // settings table stores all values JSON-encoded; rawSet/rawGet callers must keep that invariant
  private rawGet(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private rawSet(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  getSettings(): Settings {
    const out = { ...DEFAULT_SETTINGS } as Settings;
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = this.rawGet(k);
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = JSON.parse(v);
    }
    return out;
  }

  patchSettings(patch: Partial<Settings>): void {
    const tx = this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) this.rawSet(k, JSON.stringify(v));
    });
    tx();
  }

  insertHistory(e: NewHistoryEntry): HistoryEntry {
    const now = new Date().toISOString();
    const entry: HistoryEntry = {
      id: uuidv7(), createdAt: now, updatedAt: now, deletedAt: null,
      deviceId: this.getSettings().deviceId, ...e,
    };
    this.db.prepare(`INSERT INTO history
      (id, raw_text, formatted_text, created_at, updated_at, deleted_at, device_id,
       stt_provider, stt_model, llm_provider, llm_model, duration_ms, unformatted)
      VALUES (@id,@rawText,@formattedText,@createdAt,@updatedAt,@deletedAt,@deviceId,
       @sttProvider,@sttModel,@llmProvider,@llmModel,@durationMs,@unformattedInt)`)
      .run({ ...entry, unformattedInt: entry.unformatted ? 1 : 0 });
    return entry;
  }

  private mapRow(r: Record<string, unknown>): HistoryEntry {
    return {
      id: r.id as string, rawText: r.raw_text as string, formattedText: r.formatted_text as string,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string, deletedAt: r.deleted_at as string | null,
      deviceId: r.device_id as string, sttProvider: r.stt_provider as string, sttModel: r.stt_model as string,
      llmProvider: r.llm_provider as string, llmModel: r.llm_model as string,
      durationMs: r.duration_ms as number, unformatted: !!r.unformatted,
    };
  }

  listHistory(opts: { limit: number; search?: string }): HistoryEntry[] {
    const where = ['deleted_at IS NULL'];
    const params: Record<string, unknown> = { limit: opts.limit };
    if (opts.search) { where.push('(formatted_text LIKE @q OR raw_text LIKE @q)'); params.q = `%${opts.search}%`; }
    const rows = this.db.prepare(
      `SELECT * FROM history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT @limit`,
    ).all(params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  getHistoryById(id: string): HistoryEntry | null {
    const exact = this.db.prepare('SELECT * FROM history WHERE id=? AND deleted_at IS NULL LIMIT 1').get(id);
    if (exact) return this.mapRow(exact as Record<string, unknown>);
    // prefix match — CLI short-id convenience
    const pref = this.db.prepare("SELECT * FROM history WHERE id LIKE ? AND deleted_at IS NULL LIMIT 1").get(id + '%');
    return pref ? this.mapRow(pref as Record<string, unknown>) : null;
  }

  clearHistory(): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE history SET deleted_at=?, updated_at=? WHERE deleted_at IS NULL').run(now, now);
  }

  purgeOldHistory(retentionMs: number): void {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    const now = new Date().toISOString();
    this.db.prepare('UPDATE history SET deleted_at=?, updated_at=? WHERE deleted_at IS NULL AND created_at < ?').run(now, now, cutoff);
  }

  /** Physically deletes all history rows (incl. tombstones). Used by nuke — not by routine clears, which tombstone for sync-readiness. */
  wipeHistory(): void {
    this.db.prepare('DELETE FROM history').run();
  }

  /** test-only helper */
  backdateForTest(id: string, createdAt: string): void {
    this.db.prepare('UPDATE history SET created_at=? WHERE id=?').run(createdAt, id);
  }

  /** test-only helper — returns total row count regardless of tombstone status */
  countAllForTest(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM history').get() as { n: number };
    return row.n;
  }

  close(): void { this.db.close(); }
}
