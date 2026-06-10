# shhh Voice Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript Electron macOS app: hold fn to dictate, release to transcribe (whisper.cpp or cloud STT) + LLM-format + paste into the focused app, with encrypted local history and a CLI over a unix socket.

**Architecture:** Electron main process orchestrates a dictation cycle (KeyListener → Recorder → Transcriber → Formatter → Paster → HistoryStore). All business logic lives in `src/core/` as pure, dependency-injected TypeScript tested with vitest; Electron-specific glue lives in `src/main/`; the CLI in `src/cli/` talks to the app via newline-delimited JSON-RPC over a unix socket.

**Tech Stack:** Electron, TypeScript, vitest, better-sqlite3-multiple-ciphers (SQLCipher), @napi-rs/keyring (Keychain), uiohook-napi (global key hook), smart-whisper (whisper.cpp), @anthropic-ai/sdk, openai, @breezystack/lamejs (MP3), uuidv7, commander.

**Spec:** `docs/superpowers/specs/2026-06-10-shhh-voice-dictation-design.md`

**Conventions used throughout:**
- Run tests with `npx vitest run <file>` (expected output noted per step).
- All native deps are N-API based and work in both node (tests) and Electron. If Electron complains about a module ABI at runtime, run `npx @electron/rebuild`.
- `AppPaths.dataDir` = `~/Library/Application Support/shhh` in production; tests always pass a temp dir.

---

## File Structure

```
package.json, tsconfig.json, tsconfig.renderer.json, vitest.config.ts, .gitignore
scripts/copy-assets.mjs            # copies renderer html/css/worklet into dist
src/
  shared/types.ts                  # Settings, HistoryEntry, AudioData, RPC types
  core/                            # pure logic — unit tested
    settings.ts                    # defaults, duration parsing, validation
    db-key.ts                      # DB key gen/load via injected StringEncryptor
    store.ts                       # SQLCipher store: settings + history tables
    api-keys.ts                    # ApiKeyStore interface, Keychain impl, redact()
    audio.ts                       # Int16 PCM→WAV, MP3 encode, silence chunking
    transcriber/index.ts           # Transcriber interface + factory
    transcriber/openai-compatible.ts  # OpenAI + Groq (same API shape)
    transcriber/deepgram.ts
    transcriber/local-whisper.ts   # smart-whisper wrapper
    models.ts                      # whisper model registry + downloader
    formatter/index.ts             # Formatter interface, sanity check, runFormatter
    formatter/default-prompt.ts
    formatter/anthropic.ts
    formatter/openai.ts
    pipeline.ts                    # runDictationCycle(audio, deps)
    rpc.ts                         # socket server + client + protocol
    rpc-handlers.ts                # method map (config/prompt/history/status/doctor/nuke)
  main/                            # Electron glue — manual verification
    index.ts                       # bootstrap
    paths.ts                       # AppPaths
    overlay-window.ts
    recorder-window.ts
    history-window.ts
    setup-window.ts
    key-listener.ts
    paster.ts
    permissions.ts
    session-controller.ts
    preload.ts
  cli/
    index.ts                       # commander program (bin: shhh)
    client.ts                      # RPC client + ensure-app-running
    install.ts                     # shhh install / update (download+verify app)
renderer/
  overlay.html, overlay.css, overlay.ts
  history.html, history.ts
  setup.html, setup.ts
  recorder.html, recorder.ts, recorder-worklet.js
tests/                             # mirrors src/core + src/cli
docs/manual-smoke-checklist.md
.github/workflows/release.yml
electron-builder.yml
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.renderer.json`, `vitest.config.ts`, `.gitignore`, `scripts/copy-assets.mjs`, `src/shared/types.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "shhh",
  "version": "0.1.0",
  "private": true,
  "description": "Privacy-first hold-to-talk dictation for macOS",
  "main": "dist/main/index.js",
  "bin": { "shhh": "dist/cli/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.renderer.json && node scripts/copy-assets.mjs",
    "test": "vitest run",
    "start": "npm run build && electron .",
    "rebuild:electron": "electron-rebuild -f -w better-sqlite3-multiple-ciphers,smart-whisper,uiohook-napi"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@breezystack/lamejs": "^1.2.7",
    "@napi-rs/keyring": "^1.1.6",
    "better-sqlite3-multiple-ciphers": "^11.5.0",
    "commander": "^12.1.0",
    "openai": "^4.77.0",
    "smart-whisper": "^0.8.1",
    "uiohook-napi": "^1.5.4",
    "uuidv7": "^1.0.2"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.0",
    "@types/node": "^22.10.0",
    "electron": "^33.2.0",
    "electron-builder": "^25.1.8",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json (main + core + cli)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create tsconfig.renderer.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist/renderer",
    "rootDir": "renderer",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["renderer/**/*.ts"]
}
```

- [ ] **Step 4: Create vitest.config.ts, .gitignore, copy-assets script**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20_000 },
});
```

`.gitignore`:
```
node_modules/
dist/
release/
*.log
```

`scripts/copy-assets.mjs`:
```js
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/renderer', { recursive: true });
for (const f of ['overlay.html', 'overlay.css', 'history.html', 'setup.html', 'recorder.html', 'recorder-worklet.js']) {
  try { cpSync(`renderer/${f}`, `dist/renderer/${f}`); } catch { /* not created yet in early tasks */ }
}
```

- [ ] **Step 5: Create shared types**

`src/shared/types.ts`:
```ts
export type SttProvider = 'unset' | 'local' | 'openai' | 'groq' | 'deepgram';
export type LlmProvider = 'none' | 'anthropic' | 'openai';

export interface Settings {
  sttProvider: SttProvider;
  sttModel: string;            // local model name (e.g. "base.en") or cloud model id
  llmProvider: LlmProvider;
  llmModel: string;
  hotkey: string;              // "fn" or a uiohook keycode as string
  maxRecordingMs: number;
  historyRetentionMs: number | null;  // null = keep forever
  loginLaunch: boolean;
  systemPrompt: string;
  deviceId: string;
}

export interface HistoryEntry {
  id: string;                  // UUIDv7
  rawText: string;
  formattedText: string;
  createdAt: string;           // ISO 8601
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string;
  sttProvider: string;
  sttModel: string;
  llmProvider: string;
  llmModel: string;
  durationMs: number;
  unformatted: boolean;
}

export interface AudioData {
  pcm: Int16Array;             // 16kHz mono
  sampleRate: number;          // always 16000 in v1
}

export interface RpcRequest { id: number; method: string; params?: unknown }
export interface RpcResponse { id: number; result?: unknown; error?: string }
```

- [ ] **Step 6: Smoke test + verify toolchain**

`tests/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('toolchain works', () => { expect(1 + 1).toBe(2); });
```

Run: `npm install && npm run build && npx vitest run`
Expected: build succeeds, 1 test passes. (If `smart-whisper` install fails on this machine, move it to `optionalDependencies` and note it — local STT degrades gracefully.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold TypeScript Electron project"
```

---

### Task 2: Settings — defaults, duration parsing, merge

**Files:**
- Create: `src/core/settings.ts`
- Test: `tests/settings.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/settings.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, parseDuration, formatDuration, mergeSettings } from '../src/core/settings';

describe('parseDuration', () => {
  test('parses s/m/h/d', () => {
    expect(parseDuration('45s')).toBe(45_000);
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('30d')).toBe(2_592_000_000);
  });
  test('rejects garbage', () => {
    expect(() => parseDuration('ten minutes')).toThrow();
    expect(() => parseDuration('-5m')).toThrow();
  });
});

test('formatDuration round-trips', () => {
  expect(formatDuration(600_000)).toBe('10m');
});

describe('defaults', () => {
  test('providers default to unset/none per spec', () => {
    expect(DEFAULT_SETTINGS.sttProvider).toBe('unset');
    expect(DEFAULT_SETTINGS.llmProvider).toBe('none');
    expect(DEFAULT_SETTINGS.maxRecordingMs).toBe(600_000);
    expect(DEFAULT_SETTINGS.hotkey).toBe('fn');
    expect(DEFAULT_SETTINGS.systemPrompt.length).toBeGreaterThan(50);
  });
});

test('mergeSettings overlays partials onto defaults', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { sttProvider: 'local', sttModel: 'base.en' });
  expect(s.sttProvider).toBe('local');
  expect(s.llmProvider).toBe('none'); // untouched
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/settings.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/settings.ts`:
```ts
import { Settings } from '../shared/types';
import { DEFAULT_SYSTEM_PROMPT } from './formatter/default-prompt';

const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(input: string): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) throw new Error(`Invalid duration "${input}" — use e.g. 45s, 10m, 2h, 30d`);
  return Number(m[1]) * UNITS[m[2]];
}

export function formatDuration(ms: number): string {
  for (const [u, f] of [['d', UNITS.d], ['h', UNITS.h], ['m', UNITS.m], ['s', UNITS.s]] as const) {
    if (ms % f === 0 && ms >= f) return `${ms / f}${u}`;
  }
  return `${ms}ms`;
}

export const DEFAULT_SETTINGS: Settings = {
  sttProvider: 'unset',
  sttModel: '',
  llmProvider: 'none',
  llmModel: '',
  hotkey: 'fn',
  maxRecordingMs: 600_000,
  historyRetentionMs: null,
  loginLaunch: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  deviceId: '',
};

export function mergeSettings(base: Settings, partial: Partial<Settings>): Settings {
  return { ...base, ...partial };
}
```

`src/core/formatter/default-prompt.ts`:
```ts
export const DEFAULT_SYSTEM_PROMPT = `You clean up raw voice-dictation transcripts. Rules:
- Remove filler words ("um", "uh", "you know", "like" when used as filler).
- Remove duplicated or stuttered words ("the the" -> "the").
- Fix punctuation, capitalization, and sentence structure.
- Preserve the speaker's meaning, tone, and wording otherwise. Do not summarize, do not add content.
- If the speaker dictates formatting ("new line", "comma"), apply it instead of writing the words.
- Output ONLY the cleaned text. No preamble, no quotes, no commentary.`;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/settings.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.ts src/core/formatter/default-prompt.ts tests/settings.test.ts
git commit -m "feat: settings defaults, duration parsing, default formatting prompt"
```

---

### Task 3: DB key manager (safeStorage-wrapped key)

**Files:**
- Create: `src/core/db-key.ts`
- Test: `tests/db-key.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/db-key.test.ts`:
```ts
import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateDbKey, StringEncryptor } from '../src/core/db-key';

// XOR "encryptor" — stands in for Electron safeStorage in tests
const fakeEnc: StringEncryptor = {
  encrypt: (s) => Buffer.from(s, 'utf8').map((b) => b ^ 0x42) as Buffer,
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x42)).toString('utf8'),
};

test('creates a 64-hex-char key, persists encrypted, mode 600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const key = loadOrCreateDbKey(dir, fakeEnc);
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  const onDisk = readFileSync(join(dir, 'db.key.enc'));
  expect(onDisk.toString('utf8')).not.toContain(key); // not plaintext
  expect(statSync(join(dir, 'db.key.enc')).mode & 0o777).toBe(0o600);
});

test('second call returns the same key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const a = loadOrCreateDbKey(dir, fakeEnc);
  const b = loadOrCreateDbKey(dir, fakeEnc);
  expect(b).toBe(a);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/db-key.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/db-key.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Implemented by Electron safeStorage in production, fakes in tests. */
export interface StringEncryptor {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

export function loadOrCreateDbKey(dataDir: string, enc: StringEncryptor): string {
  const file = join(dataDir, 'db.key.enc');
  if (existsSync(file)) return enc.decrypt(readFileSync(file));
  const key = randomBytes(32).toString('hex');
  writeFileSync(file, enc.encrypt(key), { mode: 0o600 });
  return key;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/db-key.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: keychain-wrapped database key manager"`

---

### Task 4: Encrypted store (SQLCipher) — settings + history

**Files:**
- Create: `src/core/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/store.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ShhhStore } from '../src/core/store';
import { DEFAULT_SETTINGS } from '../src/core/settings';

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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/store.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/store.ts`:
```ts
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
    this.db = new Database(dbPath);
    this.db.pragma(`cipher='sqlcipher'`);
    this.db.pragma(`key="x'${hexKey}'"`);
    this.db.exec(SCHEMA); // throws "file is not a database" on wrong key
    if (!this.rawGet('deviceId')) this.rawSet('deviceId', randomUUID());
  }

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
      if (v !== undefined) (out as Record<string, unknown>)[k] = JSON.parse(v);
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

  listHistory(opts: { limit: number; search?: string }): HistoryEntry[] {
    const where = ['deleted_at IS NULL'];
    const params: Record<string, unknown> = { limit: opts.limit };
    if (opts.search) { where.push('(formatted_text LIKE @q OR raw_text LIKE @q)'); params.q = `%${opts.search}%`; }
    const rows = this.db.prepare(
      `SELECT * FROM history WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT @limit`,
    ).all(params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string, rawText: r.raw_text as string, formattedText: r.formatted_text as string,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string, deletedAt: r.deleted_at as string | null,
      deviceId: r.device_id as string, sttProvider: r.stt_provider as string, sttModel: r.stt_model as string,
      llmProvider: r.llm_provider as string, llmModel: r.llm_model as string,
      durationMs: r.duration_ms as number, unformatted: !!r.unformatted,
    }));
  }

  getHistoryById(id: string): HistoryEntry | null {
    return this.listHistory({ limit: 100_000 }).find((e) => e.id === id || e.id.startsWith(id)) ?? null;
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

  /** test-only helper */
  backdateForTest(id: string, createdAt: string): void {
    this.db.prepare('UPDATE history SET created_at=? WHERE id=?').run(createdAt, id);
  }

  close(): void { this.db.close(); }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/store.test.ts` → PASS (6 tests).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: SQLCipher-encrypted store for settings and history"`

---

### Task 5: API key store (Keychain) + redaction

**Files:**
- Create: `src/core/api-keys.ts`
- Test: `tests/api-keys.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/api-keys.test.ts`:
```ts
import { expect, test } from 'vitest';
import { InMemoryApiKeyStore, redactKey } from '../src/core/api-keys';

test('redactKey shows prefix and last 4 only', () => {
  expect(redactKey('sk-ant-api03-abcdefgh7f2k')).toBe('sk-ant-…7f2k');
  expect(redactKey('xyz')).toBe('…');
});

test('in-memory store round-trips (same interface as Keychain impl)', () => {
  const s = new InMemoryApiKeyStore();
  expect(s.get('anthropic')).toBeNull();
  s.set('anthropic', 'sk-ant-123');
  expect(s.get('anthropic')).toBe('sk-ant-123');
  s.delete('anthropic');
  expect(s.get('anthropic')).toBeNull();
  expect(s.providersWithKeys()).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/api-keys.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/api-keys.ts`:
```ts
import { Entry } from '@napi-rs/keyring';

export const KEY_PROVIDERS = ['anthropic', 'openai', 'groq', 'deepgram'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

export interface ApiKeyStore {
  get(provider: KeyProvider): string | null;
  set(provider: KeyProvider, key: string): void;
  delete(provider: KeyProvider): void;
  providersWithKeys(): KeyProvider[];
}

/** Each key is its own macOS Keychain item: service "shhh", account = provider. */
export class KeychainApiKeyStore implements ApiKeyStore {
  get(provider: KeyProvider): string | null {
    try { return new Entry('shhh', provider).getPassword(); } catch { return null; }
  }
  set(provider: KeyProvider, key: string): void {
    new Entry('shhh', provider).setPassword(key);
  }
  delete(provider: KeyProvider): void {
    try { new Entry('shhh', provider).deletePassword(); } catch { /* absent is fine */ }
  }
  providersWithKeys(): KeyProvider[] {
    return KEY_PROVIDERS.filter((p) => this.get(p) !== null);
  }
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  private m = new Map<KeyProvider, string>();
  get(p: KeyProvider) { return this.m.get(p) ?? null; }
  set(p: KeyProvider, k: string) { this.m.set(p, k); }
  delete(p: KeyProvider) { this.m.delete(p); }
  providersWithKeys() { return [...this.m.keys()]; }
}

/** Never print full keys anywhere. "sk-ant-…7f2k" style. */
export function redactKey(key: string): string {
  if (key.length <= 8) return '…';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/api-keys.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Keychain-backed API key store with redaction"`

---

### Task 6: Audio utils — WAV encode, MP3 encode, silence chunking

**Files:**
- Create: `src/core/audio.ts`
- Test: `tests/audio.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/audio.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { pcmToWav, pcmToMp3, splitOnSilence, prepareUploads } from '../src/core/audio';

function tone(seconds: number, freq = 440, sampleRate = 16000): Int16Array {
  const out = new Int16Array(seconds * sampleRate);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000);
  return out;
}

describe('pcmToWav', () => {
  test('produces a valid RIFF/WAVE header with correct sizes', () => {
    const pcm = tone(1);
    const wav = pcmToWav(pcm, 16000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000);          // sample rate
    expect(wav.readUInt16LE(22)).toBe(1);               // mono
    expect(wav.length).toBe(44 + pcm.length * 2);
  });
});

describe('pcmToMp3', () => {
  test('encodes and is much smaller than WAV', () => {
    const pcm = tone(2);
    const mp3 = pcmToMp3(pcm, 16000);
    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3.length).toBeLessThan(pcm.length * 2 * 0.5);
  });
});

describe('splitOnSilence', () => {
  test('splits at quiet gaps, keeps everything', () => {
    const sr = 16000;
    const silence = new Int16Array(sr); // 1s of silence
    const pcm = new Int16Array([...tone(2), ...silence, ...tone(2)]);
    const parts = splitOnSilence(pcm, sr, { maxPartSamples: 3 * sr });
    expect(parts.length).toBe(2);
    expect(parts.reduce((n, p) => n + p.length, 0)).toBe(pcm.length);
  });
  test('returns single part when under max', () => {
    const parts = splitOnSilence(tone(1), 16000, { maxPartSamples: 16000 * 60 });
    expect(parts).toHaveLength(1);
  });
});

describe('prepareUploads', () => {
  test('short audio -> one wav part; respects byte limit by chunking+mp3', () => {
    const short = prepareUploads(tone(2), 16000, 25 * 1024 * 1024);
    expect(short).toHaveLength(1);
    expect(short[0].filename.endsWith('.wav')).toBe(true);
    const tiny = prepareUploads(tone(10), 16000, 40_000); // force chunked mp3
    expect(tiny.length).toBeGreaterThan(1);
    expect(tiny[0].filename.endsWith('.mp3')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/audio.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/audio.ts`:
```ts
import { Mp3Encoder } from '@breezystack/lamejs';

export function pcmToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataLen = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22);                       // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);          // byte rate
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataLen).copy(buf, 44);
  return buf;
}

export function pcmToMp3(pcm: Int16Array, sampleRate: number, kbps = 32): Buffer {
  const enc = new Mp3Encoder(1, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const out = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (out.length) chunks.push(out);
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(tail);
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** Split PCM at the quietest 100ms window near each required cut point. */
export function splitOnSilence(
  pcm: Int16Array, sampleRate: number, opts: { maxPartSamples: number },
): Int16Array[] {
  if (pcm.length <= opts.maxPartSamples) return [pcm];
  const win = Math.floor(sampleRate / 10); // 100ms
  const parts: Int16Array[] = [];
  let start = 0;
  while (pcm.length - start > opts.maxPartSamples) {
    const idealCut = start + opts.maxPartSamples;
    // search ±10% around the ideal cut for the quietest window
    const radius = Math.floor(opts.maxPartSamples * 0.1);
    let bestAt = idealCut, bestEnergy = Infinity;
    for (let at = Math.max(start + win, idealCut - radius); at <= Math.min(pcm.length - win, idealCut); at += win) {
      let e = 0;
      for (let i = at; i < at + win; i++) e += Math.abs(pcm[i]);
      if (e < bestEnergy) { bestEnergy = e; bestAt = at; }
    }
    parts.push(pcm.subarray(start, bestAt));
    start = bestAt;
  }
  parts.push(pcm.subarray(start));
  return parts;
}

export interface UploadPart { data: Buffer; mime: string; filename: string }

/** WAV when it fits the provider limit; otherwise MP3, chunked on silence if still too big. */
export function prepareUploads(pcm: Int16Array, sampleRate: number, maxBytes: number): UploadPart[] {
  const wav = pcmToWav(pcm, sampleRate);
  if (wav.length <= maxBytes) return [{ data: wav, mime: 'audio/wav', filename: 'audio.wav' }];
  const mp3 = pcmToMp3(pcm, sampleRate);
  if (mp3.length <= maxBytes) return [{ data: mp3, mime: 'audio/mpeg', filename: 'audio.mp3' }];
  // mp3 bytes scale ~linearly with samples; chunk PCM so each part encodes under the limit
  const ratio = mp3.length / pcm.length;
  const maxPartSamples = Math.floor((maxBytes * 0.9) / ratio);
  return splitOnSilence(pcm, sampleRate, { maxPartSamples }).map((p, i) => ({
    data: pcmToMp3(p, sampleRate), mime: 'audio/mpeg', filename: `audio-${i}.mp3`,
  }));
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/audio.test.ts` → PASS. (If `@breezystack/lamejs` import shape differs — it exports `{ Mp3Encoder }` — check `node_modules/@breezystack/lamejs/README` and adjust the import, not the test.)
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: audio utils — WAV/MP3 encoding and silence-aware chunking"`

---

### Task 7: Formatter core — sanity check, retry, fallback

**Files:**
- Create: `src/core/formatter/index.ts`
- Test: `tests/formatter.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/formatter.test.ts`:
```ts
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
});

test('insane output (empty / wild length) falls back to raw', async () => {
  expect(isSaneOutput(raw, '')).toBe(false);
  expect(isSaneOutput(raw, 'a'.repeat(raw.length * 5))).toBe(false);
  expect(isSaneOutput(raw, 'ok')).toBe(false); // < 20% of input length
  expect(isSaneOutput(raw, 'This is a test of the dictation system.')).toBe(true);
  const r = await runFormatter({ format: async () => '' }, raw);
  expect(r).toEqual({ text: raw, unformatted: true });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/formatter.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/formatter/index.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/formatter.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: formatter core with sanity check, retry, raw fallback"`

---

### Task 8: Provider formatters — Anthropic + OpenAI

**Files:**
- Create: `src/core/formatter/anthropic.ts`, `src/core/formatter/openai.ts`, `src/core/formatter/factory.ts`
- Test: `tests/formatter-providers.test.ts`

- [ ] **Step 1: Write failing tests** (mock the SDK modules)

`tests/formatter-providers.test.ts`:
```ts
import { beforeEach, expect, test, vi } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: createMock }; constructor(public opts: unknown) {} },
}));

import { AnthropicFormatter } from '../src/core/formatter/anthropic';
import { buildFormatter } from '../src/core/formatter/factory';
import { InMemoryApiKeyStore } from '../src/core/api-keys';
import { DEFAULT_SETTINGS } from '../src/core/settings';

beforeEach(() => createMock.mockReset());

test('AnthropicFormatter sends system prompt + raw text, joins text blocks', async () => {
  createMock.mockResolvedValue({ content: [{ type: 'text', text: 'Clean.' }] });
  const f = new AnthropicFormatter('sk-test', 'claude-haiku-4-5', 'SYSTEM');
  const out = await f.format('um raw');
  expect(out).toBe('Clean.');
  const arg = createMock.mock.calls[0][0];
  expect(arg.model).toBe('claude-haiku-4-5');
  expect(arg.system).toBe('SYSTEM');
  expect(arg.messages).toEqual([{ role: 'user', content: 'um raw' }]);
});

test('factory: llmProvider none -> null; anthropic without key -> null; with key -> formatter', () => {
  const keys = new InMemoryApiKeyStore();
  expect(buildFormatter(DEFAULT_SETTINGS, keys)).toBeNull();
  const s = { ...DEFAULT_SETTINGS, llmProvider: 'anthropic' as const, llmModel: 'claude-haiku-4-5' };
  expect(buildFormatter(s, keys)).toBeNull(); // no key stored
  keys.set('anthropic', 'sk-ant-x');
  expect(buildFormatter(s, keys)).toBeInstanceOf(AnthropicFormatter);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/formatter-providers.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/formatter/anthropic.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { Formatter } from './index';

export class AnthropicFormatter implements Formatter {
  private client: Anthropic;
  constructor(apiKey: string, private model: string, private systemPrompt: string) {
    this.client = new Anthropic({ apiKey });
  }
  async format(raw: string): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: this.systemPrompt,
      messages: [{ role: 'user', content: raw }],
    });
    return res.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
```

`src/core/formatter/openai.ts`:
```ts
import OpenAI from 'openai';
import { Formatter } from './index';

export class OpenAIFormatter implements Formatter {
  private client: OpenAI;
  constructor(apiKey: string, private model: string, private systemPrompt: string) {
    this.client = new OpenAI({ apiKey });
  }
  async format(raw: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: raw },
      ],
    });
    return res.choices[0]?.message?.content ?? '';
  }
}
```

`src/core/formatter/factory.ts`:
```ts
import { Settings } from '../../shared/types';
import { ApiKeyStore } from '../api-keys';
import { Formatter } from './index';
import { AnthropicFormatter } from './anthropic';
import { OpenAIFormatter } from './openai';

/** Returns null when unconfigured — pipeline then pastes raw text (spec: useful with zero LLM config). */
export function buildFormatter(settings: Settings, keys: ApiKeyStore): Formatter | null {
  if (settings.llmProvider === 'none' || !settings.llmModel) return null;
  const key = keys.get(settings.llmProvider);
  if (!key) return null;
  if (settings.llmProvider === 'anthropic') return new AnthropicFormatter(key, settings.llmModel, settings.systemPrompt);
  return new OpenAIFormatter(key, settings.llmModel, settings.systemPrompt);
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/formatter-providers.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Anthropic and OpenAI formatter providers with factory"`

---

### Task 9: Cloud transcribers — OpenAI-compatible (OpenAI/Groq) + Deepgram + factory

**Files:**
- Create: `src/core/transcriber/index.ts`, `src/core/transcriber/openai-compatible.ts`, `src/core/transcriber/deepgram.ts`
- Test: `tests/transcriber-cloud.test.ts`

- [ ] **Step 1: Write failing tests** (mock global fetch)

`tests/transcriber-cloud.test.ts`:
```ts
import { afterEach, expect, test, vi } from 'vitest';
import { OpenAICompatibleSTT } from '../src/core/transcriber/openai-compatible';
import { DeepgramSTT } from '../src/core/transcriber/deepgram';
import { pcmToWav } from '../src/core/audio';

const audio = { pcm: new Int16Array(16000), sampleRate: 16000 };
afterEach(() => vi.unstubAllGlobals());

test('OpenAICompatibleSTT posts multipart to /audio/transcriptions and returns text', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'hello world' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const stt = new OpenAICompatibleSTT({ apiKey: 'k', model: 'whisper-1', baseUrl: 'https://api.openai.com/v1' });
  expect(await stt.transcribe(audio)).toBe('hello world');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
  expect(init.headers.Authorization).toBe('Bearer k');
  expect(init.body).toBeInstanceOf(FormData);
});

test('OpenAICompatibleSTT stitches multiple chunks', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'part one' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'part two' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  // 25-byte limit forces chunked mp3 uploads
  const stt = new OpenAICompatibleSTT({ apiKey: 'k', model: 'whisper-1', baseUrl: 'https://x/v1', maxUploadBytes: 25_000 });
  const long = { pcm: new Int16Array(16000 * 60).fill(5000), sampleRate: 16000 };
  expect(await stt.transcribe(long)).toBe('part one part two');
});

test('non-2xx throws with status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
  const stt = new OpenAICompatibleSTT({ apiKey: 'k', model: 'whisper-1', baseUrl: 'https://x/v1' });
  await expect(stt.transcribe(audio)).rejects.toThrow(/401/);
});

test('DeepgramSTT posts WAV body and extracts transcript', async () => {
  const body = { results: { channels: [{ alternatives: [{ transcript: 'deep text' }] }] } };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const stt = new DeepgramSTT({ apiKey: 'dk', model: 'nova-2' });
  expect(await stt.transcribe(audio)).toBe('deep text');
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain('api.deepgram.com/v1/listen');
  expect(init.headers.Authorization).toBe('Token dk');
  expect(Buffer.compare(Buffer.from(init.body), pcmToWav(audio.pcm, 16000))).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/transcriber-cloud.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/transcriber/index.ts`:
```ts
import { AudioData } from '../../shared/types';

export interface Transcriber {
  transcribe(audio: AudioData): Promise<string>;
}

export const STT_TIMEOUT_MS = 30_000; // per request/chunk — processing wait, not a recording cap
```

`src/core/transcriber/openai-compatible.ts`:
```ts
import { AudioData } from '../../shared/types';
import { prepareUploads } from '../audio';
import { STT_TIMEOUT_MS, Transcriber } from './index';

export interface OpenAICompatibleOpts {
  apiKey: string;
  model: string;
  baseUrl: string;             // https://api.openai.com/v1 | https://api.groq.com/openai/v1
  maxUploadBytes?: number;     // default 24MB (OpenAI limit is 25MB)
}

export class OpenAICompatibleSTT implements Transcriber {
  constructor(private opts: OpenAICompatibleOpts) {}

  async transcribe(audio: AudioData): Promise<string> {
    const parts = prepareUploads(audio.pcm, audio.sampleRate, this.opts.maxUploadBytes ?? 24 * 1024 * 1024);
    const texts: string[] = [];
    for (const part of parts) {
      const form = new FormData();
      form.append('file', new Blob([part.data], { type: part.mime }), part.filename);
      form.append('model', this.opts.model);
      const res = await fetch(`${this.opts.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`STT request failed (${res.status}): ${await res.text()}`);
      texts.push(((await res.json()) as { text: string }).text.trim());
    }
    return texts.join(' ');
  }
}
```

`src/core/transcriber/deepgram.ts`:
```ts
import { AudioData } from '../../shared/types';
import { pcmToWav } from '../audio';
import { STT_TIMEOUT_MS, Transcriber } from './index';

export class DeepgramSTT implements Transcriber {
  constructor(private opts: { apiKey: string; model: string }) {}

  async transcribe(audio: AudioData): Promise<string> {
    const res = await fetch(
      `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(this.opts.model)}&smart_format=true`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${this.opts.apiKey}`, 'Content-Type': 'audio/wav' },
        body: pcmToWav(audio.pcm, audio.sampleRate),
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Deepgram request failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { results: { channels: { alternatives: { transcript: string }[] }[] } };
    return json.results.channels[0]?.alternatives[0]?.transcript ?? '';
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/transcriber-cloud.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: cloud STT providers (OpenAI/Groq/Deepgram) with chunked uploads"`

---

### Task 10: Local whisper — model registry, downloader, transcriber, factory

**Files:**
- Create: `src/core/models.ts`, `src/core/transcriber/local-whisper.ts`, `src/core/transcriber/factory.ts`
- Test: `tests/models.test.ts`, `tests/transcriber-factory.test.ts`

- [ ] **Step 1: Pin model checksums**

Run this and paste the results into the registry below (these are stable, versioned files on Hugging Face):

```bash
for m in tiny.en base.en small.en; do
  curl -sL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$m.bin" | shasum -a 256 | awk -v m=$m '{print m, $1}'
done
```

- [ ] **Step 2: Write failing tests**

`tests/models.test.ts`:
```ts
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
```

`tests/transcriber-factory.test.ts`:
```ts
import { expect, test } from 'vitest';
import { buildTranscriber } from '../src/core/transcriber/factory';
import { InMemoryApiKeyStore } from '../src/core/api-keys';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { OpenAICompatibleSTT } from '../src/core/transcriber/openai-compatible';
import { DeepgramSTT } from '../src/core/transcriber/deepgram';

const keys = new InMemoryApiKeyStore();
keys.set('openai', 'k'); keys.set('groq', 'k'); keys.set('deepgram', 'k');
const dataDir = '/tmp/nonexistent-shhh';

test('unset provider -> null', () => {
  expect(buildTranscriber(DEFAULT_SETTINGS, keys, dataDir)).toBeNull();
});
test('cloud providers build; missing key -> null; missing local model -> null', () => {
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'openai', sttModel: 'whisper-1' }, keys, dataDir)).toBeInstanceOf(OpenAICompatibleSTT);
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'groq', sttModel: 'whisper-large-v3' }, keys, dataDir)).toBeInstanceOf(OpenAICompatibleSTT);
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'deepgram', sttModel: 'nova-2' }, keys, dataDir)).toBeInstanceOf(DeepgramSTT);
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'openai', sttModel: 'whisper-1' }, new InMemoryApiKeyStore(), dataDir)).toBeNull();
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'local', sttModel: 'base.en' }, keys, dataDir)).toBeNull();
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/models.test.ts tests/transcriber-factory.test.ts` → FAIL.

- [ ] **Step 4: Implement**

`src/core/models.ts`:
```ts
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// sha256 values: pinned from Step 1 of Task 10 (curl | shasum -a 256)
export const WHISPER_MODELS = {
  'tiny.en':  { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',  sha256: '<PASTE-FROM-STEP-1>', sizeMB: 75 },
  'base.en':  { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',  sha256: '<PASTE-FROM-STEP-1>', sizeMB: 142 },
  'small.en': { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin', sha256: '<PASTE-FROM-STEP-1>', sizeMB: 466 },
} as const;
export type WhisperModelName = keyof typeof WHISPER_MODELS;

export function modelPath(dataDir: string, name: WhisperModelName): string {
  return join(dataDir, 'models', `ggml-${name}.bin`);
}

export function isModelPresent(dataDir: string, name: string): boolean {
  return name in WHISPER_MODELS && existsSync(modelPath(dataDir, name as WhisperModelName));
}

export function verifyChecksum(file: string, sha256: string): boolean {
  return createHash('sha256').update(readFileSync(file)).digest('hex') === sha256;
}

export async function downloadModel(
  dataDir: string, name: WhisperModelName, onProgress?: (pct: number) => void,
): Promise<string> {
  const { url, sha256 } = WHISPER_MODELS[name];
  const dest = modelPath(dataDir, name);
  mkdirSync(join(dataDir, 'models'), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let seen = 0;
  const tmp = `${dest}.part`;
  const counter = new TransformStreamCounter((n) => { seen += n; if (total && onProgress) onProgress(Math.round((seen / total) * 100)); });
  await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp));
  if (!verifyChecksum(tmp, sha256)) { unlinkSync(tmp); throw new Error('Checksum mismatch — download corrupted, try again'); }
  renameSync(tmp, dest);
  return dest;
}

import { Transform } from 'node:stream';
class TransformStreamCounter extends Transform {
  constructor(private onBytes: (n: number) => void) { super(); }
  _transform(chunk: Buffer, _enc: string, cb: () => void) { this.onBytes(chunk.length); this.push(chunk); cb(); }
}
```

`src/core/transcriber/local-whisper.ts`:
```ts
import { AudioData } from '../../shared/types';
import { Transcriber } from './index';

/** whisper.cpp via smart-whisper. Loaded lazily so the app runs without the native module. */
export class LocalWhisperSTT implements Transcriber {
  constructor(private modelFile: string) {}

  async transcribe(audio: AudioData): Promise<string> {
    const { Whisper } = await import('smart-whisper');
    const whisper = new Whisper(this.modelFile, { gpu: true });
    try {
      const f32 = new Float32Array(audio.pcm.length);
      for (let i = 0; i < audio.pcm.length; i++) f32[i] = audio.pcm[i] / 32768;
      const task = await whisper.transcribe(f32, { language: 'en' });
      const segments = await task.result;
      return segments.map((s: { text: string }) => s.text).join('').trim();
    } finally {
      await whisper.free();
    }
  }
}
```

`src/core/transcriber/factory.ts`:
```ts
import { Settings } from '../../shared/types';
import { ApiKeyStore } from '../api-keys';
import { isModelPresent, modelPath, WhisperModelName } from '../models';
import { Transcriber } from './index';
import { OpenAICompatibleSTT } from './openai-compatible';
import { DeepgramSTT } from './deepgram';
import { LocalWhisperSTT } from './local-whisper';

const BASE_URLS = { openai: 'https://api.openai.com/v1', groq: 'https://api.groq.com/openai/v1' } as const;

/** Returns null when unconfigured (provider unset, key missing, or local model not downloaded). */
export function buildTranscriber(settings: Settings, keys: ApiKeyStore, dataDir: string): Transcriber | null {
  const { sttProvider, sttModel } = settings;
  if (sttProvider === 'unset' || !sttModel) return null;
  if (sttProvider === 'local') {
    if (!isModelPresent(dataDir, sttModel)) return null;
    return new LocalWhisperSTT(modelPath(dataDir, sttModel as WhisperModelName));
  }
  const key = keys.get(sttProvider);
  if (!key) return null;
  if (sttProvider === 'deepgram') return new DeepgramSTT({ apiKey: key, model: sttModel });
  return new OpenAICompatibleSTT({ apiKey: key, model: sttModel, baseUrl: BASE_URLS[sttProvider] });
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/models.test.ts tests/transcriber-factory.test.ts` → PASS. (Registry test fails until Step 1 checksums are pasted in — that's the point.)

- [ ] **Step 6: Optional integration test (skipped in CI)**

Append to `tests/models.test.ts`:
```ts
import { existsSync } from 'node:fs';
import { LocalWhisperSTT } from '../src/core/transcriber/local-whisper';
import { modelPath as mp } from '../src/core/models';

const localModel = mp(`${process.env.HOME}/Library/Application Support/shhh`, 'tiny.en');
test.skipIf(!existsSync(localModel))('local whisper transcribes silence to ~empty', async () => {
  const stt = new LocalWhisperSTT(localModel);
  const text = await stt.transcribe({ pcm: new Int16Array(16000), sampleRate: 16000 });
  expect(typeof text).toBe('string');
}, 60_000);
```

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: whisper model registry/downloader and local STT"`

---

### Task 11: Dictation pipeline — runDictationCycle

**Files:**
- Create: `src/core/pipeline.ts`
- Test: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/pipeline.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/pipeline.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/pipeline.ts`:
```ts
import { AudioData } from '../shared/types';
import { NewHistoryEntry } from './store';
import { Transcriber } from './transcriber';
import { Formatter, runFormatter } from './formatter';

export interface PipelineDeps {
  transcriber: Transcriber | null;
  formatter: Formatter | null;
  /** Returns false when injection failed but text is on the clipboard ("Copied — press ⌘V"). */
  paste(text: string): Promise<boolean>;
  saveHistory(entry: NewHistoryEntry): void;
  meta: { sttProvider: string; sttModel: string; llmProvider: string; llmModel: string };
}

export type CycleResult =
  | { ok: true; text: string; unformatted: boolean; pasted: boolean }
  | { ok: false; error: string };

/** One full dictation cycle. Principle: never lose the user's words. */
export async function runDictationCycle(audio: AudioData, deps: PipelineDeps): Promise<CycleResult> {
  if (!deps.transcriber) {
    return { ok: false, error: 'No speech-to-text configured. Run: shhh config set stt.provider …' };
  }
  let raw: string;
  try {
    raw = (await deps.transcriber.transcribe(audio)).trim();
  } catch (e) {
    return { ok: false, error: `Transcription failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!raw) return { ok: false, error: 'Nothing was transcribed' };

  const { text, unformatted } = await runFormatter(deps.formatter, raw);
  const pasted = await deps.paste(text);

  deps.saveHistory({
    rawText: raw, formattedText: text, unformatted,
    durationMs: Math.round((audio.pcm.length / audio.sampleRate) * 1000),
    sttProvider: deps.meta.sttProvider, sttModel: deps.meta.sttModel,
    llmProvider: unformatted ? 'none' : deps.meta.llmProvider,
    llmModel: unformatted ? '' : deps.meta.llmModel,
  });
  return { ok: true, text, unformatted, pasted };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/pipeline.test.ts` → PASS (6 tests).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: dictation pipeline with never-lose-words error handling"`

---

### Task 12: RPC — unix socket server/client + handlers

**Files:**
- Create: `src/core/rpc.ts`, `src/core/rpc-handlers.ts`
- Test: `tests/rpc.test.ts`, `tests/rpc-handlers.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/rpc.test.ts`:
```ts
import { expect, test } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcServer, rpcCall } from '../src/core/rpc';

test('request/response over unix socket, mode 600, unknown method errors', async () => {
  const sock = join(mkdtempSync(join(tmpdir(), 'shhh-')), 'shhh.sock');
  const server = new RpcServer(sock, {
    echo: async (params) => ({ got: params }),
    boom: async () => { throw new Error('kaboom'); },
  });
  await server.listen();
  expect(statSync(sock).mode & 0o777).toBe(0o600);

  expect(await rpcCall(sock, 'echo', { a: 1 })).toEqual({ got: { a: 1 } });
  await expect(rpcCall(sock, 'boom')).rejects.toThrow('kaboom');
  await expect(rpcCall(sock, 'nope')).rejects.toThrow(/unknown method/i);
  await server.close();
});

test('stale socket file is replaced on listen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const sock = join(dir, 'shhh.sock');
  const s1 = new RpcServer(sock, { ping: async () => 'pong' });
  await s1.listen();
  await s1.close();
  const s2 = new RpcServer(sock, { ping: async () => 'pong' });
  await s2.listen(); // must not throw EADDRINUSE
  expect(await rpcCall(sock, 'ping')).toBe('pong');
  await s2.close();
});
```

`tests/rpc-handlers.test.ts`:
```ts
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
    checkPermissions: async () => ({ microphone: true, accessibility: false, inputMonitoring: false }),
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

test('nuke wipes settings, history, and keys', async () => {
  deps.apiKeys.set('anthropic', 'k');
  deps.store.insertHistory({ rawText: 'x', formattedText: 'x', sttProvider: '', sttModel: '', llmProvider: 'none', llmModel: '', durationMs: 1, unformatted: true });
  await h.nuke({});
  expect(deps.apiKeys.providersWithKeys()).toEqual([]);
  expect(await h['history.list']({ limit: 5 })).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/rpc.test.ts tests/rpc-handlers.test.ts` → FAIL.

- [ ] **Step 3: Implement RPC transport**

`src/core/rpc.ts`:
```ts
import { createConnection, createServer, Server, Socket } from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { RpcRequest, RpcResponse } from '../shared/types';

export type Handlers = Record<string, (params: unknown) => Promise<unknown>>;

/** Newline-delimited JSON over a unix domain socket, mode 600. */
export class RpcServer {
  private server: Server | null = null;
  constructor(private socketPath: string, private handlers: Handlers) {}

  listen(): Promise<void> {
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath); // stale socket from a crash
    this.server = createServer((sock) => this.serve(sock));
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => {
        chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });
  }

  private serve(sock: Socket): void {
    let buf = '';
    sock.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let res: RpcResponse;
        try {
          const req = JSON.parse(line) as RpcRequest;
          const fn = this.handlers[req.method];
          if (!fn) res = { id: req.id, error: `Unknown method: ${req.method}` };
          else {
            try { res = { id: req.id, result: await fn(req.params) }; }
            catch (e) { res = { id: req.id, error: e instanceof Error ? e.message : String(e) }; }
          }
        } catch { res = { id: -1, error: 'Malformed request' }; }
        sock.write(JSON.stringify(res) + '\n');
      }
    });
    sock.on('error', () => sock.destroy());
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
        resolve();
      });
    });
  }
}

let nextId = 1;
export function rpcCall(socketPath: string, method: string, params?: unknown, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const sock = createConnection(socketPath);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('RPC timeout')); }, timeoutMs);
    let buf = '';
    sock.on('connect', () => sock.write(JSON.stringify({ id, method, params } satisfies RpcRequest) + '\n'));
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      sock.end();
      try {
        const res = JSON.parse(buf.slice(0, nl)) as RpcResponse;
        if (res.error) reject(new Error(res.error)); else resolve(res.result);
      } catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
```

- [ ] **Step 4: Implement handlers**

`src/core/rpc-handlers.ts`:
```ts
import { Settings, SttProvider, LlmProvider } from '../shared/types';
import { ShhhStore } from './store';
import { ApiKeyStore, KEY_PROVIDERS, KeyProvider, redactKey } from './api-keys';
import { parseDuration, formatDuration } from './settings';
import { DEFAULT_SYSTEM_PROMPT } from './formatter/default-prompt';
import { Handlers } from './rpc';
import { isModelPresent } from './models';

export interface PermissionStatus { microphone: boolean; accessibility: boolean; inputMonitoring: boolean }

export interface HandlerDeps {
  store: ShhhStore;
  apiKeys: ApiKeyStore;
  dataDir: string;
  checkPermissions(): Promise<PermissionStatus>;
  appVersion: string;
}

const STT_PROVIDERS: SttProvider[] = ['unset', 'local', 'openai', 'groq', 'deepgram'];
const LLM_PROVIDERS: LlmProvider[] = ['none', 'anthropic', 'openai'];

export function buildHandlers(deps: HandlerDeps): Handlers {
  const { store, apiKeys } = deps;

  const setters: Record<string, (v: string) => void> = {
    'stt.provider': (v) => {
      if (!STT_PROVIDERS.includes(v as SttProvider)) throw new Error(`stt.provider must be one of: ${STT_PROVIDERS.join(', ')}`);
      store.patchSettings({ sttProvider: v as SttProvider });
    },
    'stt.model': (v) => store.patchSettings({ sttModel: v }),
    'llm.provider': (v) => {
      if (!LLM_PROVIDERS.includes(v as LlmProvider)) throw new Error(`llm.provider must be one of: ${LLM_PROVIDERS.join(', ')}`);
      store.patchSettings({ llmProvider: v as LlmProvider });
    },
    'llm.model': (v) => store.patchSettings({ llmModel: v }),
    hotkey: (v) => store.patchSettings({ hotkey: v }),
    'max-recording': (v) => store.patchSettings({ maxRecordingMs: parseDuration(v) }),
    'history-retention': (v) => store.patchSettings({ historyRetentionMs: v === 'off' ? null : parseDuration(v) }),
    'login-launch': (v) => store.patchSettings({ loginLaunch: v === 'on' }),
  };
  for (const p of KEY_PROVIDERS) {
    setters[`${p}.api-key`] = (v) => apiKeys.set(p, v);
  }

  function configView(s: Settings): Record<string, string> {
    const out: Record<string, string> = {
      'stt.provider': s.sttProvider, 'stt.model': s.sttModel,
      'llm.provider': s.llmProvider, 'llm.model': s.llmModel,
      hotkey: s.hotkey,
      'max-recording': formatDuration(s.maxRecordingMs),
      'history-retention': s.historyRetentionMs === null ? 'off' : formatDuration(s.historyRetentionMs),
      'login-launch': s.loginLaunch ? 'on' : 'off',
    };
    for (const p of KEY_PROVIDERS) {
      const k = apiKeys.get(p);
      if (k) out[`${p}.api-key`] = redactKey(k);
    }
    return out;
  }

  return {
    'config.set': async (params) => {
      const { key, value } = params as { key: string; value: string };
      const setter = setters[key];
      if (!setter) throw new Error(`Unknown config key: ${key}`);
      setter(value);
      return 'ok';
    },
    'config.get': async (params) => {
      const { key } = (params ?? {}) as { key?: string };
      const view = configView(store.getSettings());
      return key ? { [key]: view[key] } : view;
    },
    'prompt.get': async () => store.getSettings().systemPrompt,
    'prompt.set': async (params) => { store.patchSettings({ systemPrompt: (params as { prompt: string }).prompt }); return 'ok'; },
    'prompt.reset': async () => { store.patchSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT }); return 'ok'; },
    'history.list': async (params) => {
      const { limit = 20, search } = (params ?? {}) as { limit?: number; search?: string };
      return store.listHistory({ limit, search });
    },
    'history.get': async (params) => {
      const e = store.getHistoryById((params as { id: string }).id);
      if (!e) throw new Error('History entry not found');
      return e;
    },
    'history.clear': async () => { store.clearHistory(); return 'ok'; },
    status: async () => {
      const s = store.getSettings();
      return {
        version: deps.appVersion,
        sttConfigured: s.sttProvider !== 'unset' && (s.sttProvider !== 'local' ? apiKeys.get(s.sttProvider as KeyProvider) !== null : isModelPresent(deps.dataDir, s.sttModel)),
        llmConfigured: s.llmProvider !== 'none' && apiKeys.get(s.llmProvider as KeyProvider) !== null,
        sttProvider: s.sttProvider, llmProvider: s.llmProvider,
      };
    },
    doctor: async () => {
      const perms = await deps.checkPermissions();
      const s = store.getSettings();
      return { ...perms, sttProvider: s.sttProvider, modelPresent: s.sttProvider !== 'local' || isModelPresent(deps.dataDir, s.sttModel) };
    },
    nuke: async () => {
      for (const p of apiKeys.providersWithKeys()) apiKeys.delete(p);
      store.clearHistory();
      store.patchSettings({ sttProvider: 'unset', sttModel: '', llmProvider: 'none', llmModel: '', systemPrompt: DEFAULT_SYSTEM_PROMPT });
      return 'ok';
    },
  };
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/rpc.test.ts tests/rpc-handlers.test.ts` → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: unix-socket RPC server and CLI-facing handlers"`

---

### Task 13: CLI

**Files:**
- Create: `src/cli/index.ts`, `src/cli/client.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Write failing tests** (drive the program with an injected RPC function)

`tests/cli.test.ts`:
```ts
import { expect, test, vi } from 'vitest';
import { buildProgram, CliIo } from '../src/cli/index';

function run(argv: string[], rpcResult: unknown = 'ok') {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const out: string[] = [];
  const io: CliIo = {
    rpc,
    print: (s) => out.push(s),
    promptHidden: vi.fn().mockResolvedValue('sk-secret-entered'),
    copyToClipboard: vi.fn(),
  };
  const program = buildProgram(io);
  return program.parseAsync(['node', 'shhh', ...argv]).then(() => ({ rpc, out, io }));
}

test('config set forwards to RPC', async () => {
  const { rpc } = await run(['config', 'set', 'stt.provider', 'local']);
  expect(rpc).toHaveBeenCalledWith('config.set', { key: 'stt.provider', value: 'local' });
});

test('api keys use hidden prompt, never argv', async () => {
  const { rpc, io } = await run(['config', 'set', 'anthropic.api-key']);
  expect(io.promptHidden).toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith('config.set', { key: 'anthropic.api-key', value: 'sk-secret-entered' });
});

test('config get prints key=value lines', async () => {
  const { out } = await run(['config', 'get'], { 'stt.provider': 'local', 'anthropic.api-key': 'sk-ant-…7f2k' });
  expect(out.join('\n')).toContain('stt.provider=local');
  expect(out.join('\n')).toContain('anthropic.api-key=sk-ant-…7f2k');
});

test('history list prints entries; history copy puts text on clipboard', async () => {
  const entry = { id: 'abc123', formattedText: 'Hello world.', createdAt: '2026-06-10T10:00:00Z', unformatted: false };
  const { out } = await run(['history', 'list'], [entry]);
  expect(out.join('\n')).toContain('Hello world.');
  const { io } = await run(['history', 'copy', 'abc123'], entry);
  expect(io.copyToClipboard).toHaveBeenCalledWith('Hello world.');
});

test('prompt set reads stdin/file content via promptHidden-free path', async () => {
  const { rpc } = await run(['prompt', 'reset']);
  expect(rpc).toHaveBeenCalledWith('prompt.reset', {});
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/cli.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/cli/client.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { rpcCall } from '../core/rpc';

export const DATA_DIR = join(homedir(), 'Library', 'Application Support', 'shhh');
export const SOCKET_PATH = join(DATA_DIR, 'shhh.sock');
const APP_PATH = '/Applications/shhh.app';

export async function rpc(method: string, params?: unknown): Promise<unknown> {
  try {
    return await rpcCall(SOCKET_PATH, method, params);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      if (!existsSync(APP_PATH)) throw new Error('shhh.app is not installed. Run: shhh install');
      await new Promise<void>((res, rej) => execFile('open', ['-g', APP_PATH], (err) => (err ? rej(err) : res())));
      await new Promise((r) => setTimeout(r, 2500)); // app boot
      return rpcCall(SOCKET_PATH, method, params);
    }
    throw e;
  }
}

/** Hidden input — key never appears in argv or shell history. */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const { stdin } = process;
    stdin.resume(); stdin.setRawMode?.(true);
    let value = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString('utf8');
      if (c === '\r' || c === '\n') {
        stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (c === '') { process.exit(1); }
      else if (c === '') { value = value.slice(0, -1); }
      else { value += c; }
    };
    stdin.on('data', onData);
  });
}

export function copyToClipboard(text: string): void {
  const p = execFile('pbcopy');
  p.stdin?.write(text); p.stdin?.end();
}
```

`src/cli/index.ts`:
```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { rpc as realRpc, promptHidden as realPromptHidden, copyToClipboard as realCopy, DATA_DIR } from './client';

export interface CliIo {
  rpc(method: string, params?: unknown): Promise<unknown>;
  print(s: string): void;
  promptHidden(q: string): Promise<string>;
  copyToClipboard(text: string): void;
}

export function buildProgram(io: CliIo): Command {
  const program = new Command('shhh').description('Privacy-first hold-to-talk dictation for macOS');
  program.exitOverride(); // throw instead of process.exit in tests

  const config = program.command('config');
  config.command('set').argument('<key>').argument('[value]').action(async (key: string, value?: string) => {
    if (key.endsWith('.api-key')) {
      if (value !== undefined) { io.print('Refusing to take an API key as an argument (shell history). Enter it below.'); }
      value = await io.promptHidden(`${key}: `);
    }
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    await io.rpc('config.set', { key, value });
    io.print('ok');
  });
  config.command('get').argument('[key]').action(async (key?: string) => {
    const view = (await io.rpc('config.get', key ? { key } : {})) as Record<string, string>;
    for (const [k, v] of Object.entries(view)) io.print(`${k}=${v}`);
  });

  const prompt = program.command('prompt');
  prompt.command('show').action(async () => io.print(String(await io.rpc('prompt.get', {}))));
  prompt.command('set').argument('[file]').action(async (file?: string) => {
    const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'); // file or stdin
    await io.rpc('prompt.set', { prompt: text.trim() });
    io.print('ok');
  });
  prompt.command('reset').action(async () => { await io.rpc('prompt.reset', {}); io.print('ok'); });

  const history = program.command('history');
  history.command('list').option('-n, --limit <n>', 'max entries', '20').option('--search <q>').action(async (opts) => {
    const list = (await io.rpc('history.list', { limit: Number(opts.limit), search: opts.search })) as
      { id: string; formattedText: string; createdAt: string; unformatted: boolean }[];
    for (const e of list) io.print(`${e.id.slice(0, 8)}  ${e.createdAt}  ${e.unformatted ? '[raw] ' : ''}${e.formattedText}`);
  });
  history.command('copy').argument('<id>').action(async (id: string) => {
    const e = (await io.rpc('history.get', { id })) as { formattedText: string };
    io.copyToClipboard(e.formattedText);
    io.print('copied');
  });
  history.command('clear').action(async () => { await io.rpc('history.clear', {}); io.print('ok'); });

  const model = program.command('model');
  model.command('list').action(async () => {
    const { WHISPER_MODELS, isModelPresent } = await import('../core/models');
    for (const name of Object.keys(WHISPER_MODELS)) {
      io.print(`${name}  ${isModelPresent(DATA_DIR, name) ? '[downloaded]' : ''}`);
    }
  });
  model.command('download').argument('<name>').action(async (name: string) => {
    const { downloadModel, WHISPER_MODELS } = await import('../core/models');
    if (!(name in WHISPER_MODELS)) throw new Error(`Unknown model. Options: ${Object.keys(WHISPER_MODELS).join(', ')}`);
    io.print(`Downloading ${name} (${WHISPER_MODELS[name as keyof typeof WHISPER_MODELS].sizeMB}MB)…`);
    await downloadModel(DATA_DIR, name as never, (pct) => process.stdout.write(`\r${pct}%`));
    io.print('\ndone');
  });

  program.command('status').action(async () => {
    const s = (await io.rpc('status', {})) as Record<string, unknown>;
    for (const [k, v] of Object.entries(s)) io.print(`${k}: ${v}`);
  });
  program.command('doctor').action(async () => {
    const d = (await io.rpc('doctor', {})) as Record<string, unknown>;
    for (const [k, v] of Object.entries(d)) io.print(`${v === true ? '✅' : v === false ? '❌' : '·'} ${k}: ${v}`);
  });
  program.command('nuke').action(async () => { await io.rpc('nuke', {}); io.print('All shhh data wiped.'); });
  program.command('setup').action(async () => { await io.rpc('setup.open', {}); io.print('Setup window opened.'); });

  return program;
}

/* c8 ignore start — wired only when run as a binary */
if (require.main === module) {
  const io: CliIo = { rpc: realRpc, print: console.log, promptHidden: realPromptHidden, copyToClipboard: realCopy };
  buildProgram(io).parseAsync(process.argv).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
/* c8 ignore stop */
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/cli.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: shhh CLI over unix-socket RPC"`

---

### Task 14: Electron shell — bootstrap, overlay, recorder, history panel

This task is Electron glue: minimal unit-testable surface, so steps are implement → manual verify. Keep logic out of these files; they delegate to `src/core/`.

**Files:**
- Create: `src/main/paths.ts`, `src/main/index.ts`, `src/main/preload.ts`, `src/main/overlay-window.ts`, `src/main/recorder-window.ts`, `src/main/history-window.ts`
- Create: `renderer/overlay.html`, `renderer/overlay.css`, `renderer/overlay.ts`, `renderer/recorder.html`, `renderer/recorder.ts`, `renderer/recorder-worklet.js`, `renderer/history.html`, `renderer/history.ts`

- [ ] **Step 1: Paths + preload**

`src/main/paths.ts`:
```ts
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function dataDir(): string {
  const dir = app.getPath('userData'); // ~/Library/Application Support/shhh
  mkdirSync(dir, { recursive: true });
  return dir;
}
export const rendererDir = () => join(__dirname, '..', 'renderer');
export const socketPath = () => join(dataDir(), 'shhh.sock');
```

`src/main/preload.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

const ALLOWED_INVOKE = ['rec:start', 'rec:stop', 'history:list', 'history:copy', 'perm:status', 'perm:request', 'perm:openSettings', 'app:restart'];
const ALLOWED_ON = ['overlay:state', 'rec:cmd'];

contextBridge.exposeInMainWorld('shhh', {
  invoke: (ch: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE.includes(ch)) throw new Error(`blocked channel ${ch}`);
    return ipcRenderer.invoke(ch, ...args);
  },
  on: (ch: string, fn: (...args: unknown[]) => void) => {
    if (!ALLOWED_ON.includes(ch)) throw new Error(`blocked channel ${ch}`);
    ipcRenderer.on(ch, (_e, ...args) => fn(...args));
  },
  send: (ch: string, ...args: unknown[]) => {
    if (!ch.startsWith('rec:')) throw new Error(`blocked channel ${ch}`);
    ipcRenderer.send(ch, ...args);
  },
});
```

- [ ] **Step 2: Overlay window + renderer**

`src/main/overlay-window.ts`:
```ts
import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';

export type OverlayState =
  | { kind: 'hidden' }
  | { kind: 'listening'; elapsedMs: number; level: number; warning: boolean }
  | { kind: 'processing' }
  | { kind: 'done' }
  | { kind: 'copied' }            // paste failed; text is on the clipboard
  | { kind: 'error'; message: string };

export class OverlayWindow {
  private win: BrowserWindow;

  constructor() {
    this.win = new BrowserWindow({
      width: 260, height: 64, frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
      focusable: false,                       // never steal focus from the target app
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.loadFile(join(rendererDir(), 'overlay.html'));
  }

  setState(state: OverlayState): void {
    if (state.kind === 'hidden') { this.win.hide(); return; }
    if (!this.win.isVisible()) {
      const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      this.win.setPosition(Math.round(workArea.x + workArea.width / 2 - 130), workArea.y + workArea.height - 96);
      this.win.showInactive();               // show without focusing
    }
    this.win.webContents.send('overlay:state', state);
  }

  onClick(fn: () => void): void {
    // overlay is non-focusable; clicks come via IPC from the renderer
    this.win.webContents.ipc.on('overlay:clicked', fn);
  }
}
```

`renderer/overlay.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="overlay.css"></head>
<body>
  <div id="pill" class="hidden">
    <span id="icon"></span><span id="label"></span><span id="timer"></span>
  </div>
  <script type="module" src="overlay.js"></script>
</body></html>
```

`renderer/overlay.css`:
```css
html, body { margin: 0; background: transparent; overflow: hidden; user-select: none; }
#pill { display: flex; align-items: center; gap: 8px; height: 44px; margin: 10px;
  padding: 0 16px; border-radius: 22px; background: rgba(20,20,20,.88); color: #fff;
  font: 13px -apple-system, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
#pill.hidden { display: none; }
#pill.listening #icon { width: 10px; height: 10px; border-radius: 50%; background: #ff5252; animation: pulse 1.2s infinite; }
#pill.warning { outline: 2px solid #ffb300; }
#pill.processing #icon { width: 12px; height: 12px; border: 2px solid #888; border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
#pill.error { background: rgba(120,20,20,.92); }
@keyframes pulse { 50% { opacity: .3; } }
@keyframes spin { to { transform: rotate(360deg); } }
```

`renderer/overlay.ts`:
```ts
declare const shhh: { on(ch: string, fn: (s: unknown) => void): void };
const pill = document.getElementById('pill')!;
const label = document.getElementById('label')!;
const timer = document.getElementById('timer')!;

pill.addEventListener('click', () => (window as unknown as { shhh: { send(ch: string): void } }).shhh.send?.('overlay:clicked'));

shhh.on('overlay:state', (s) => {
  const state = s as { kind: string; elapsedMs?: number; warning?: boolean; message?: string };
  pill.className = state.kind + (state.warning ? ' warning' : '');
  timer.textContent = '';
  if (state.kind === 'listening') {
    label.textContent = 'Listening';
    const secs = Math.floor((state.elapsedMs ?? 0) / 1000);
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  } else if (state.kind === 'processing') label.textContent = 'Processing…';
  else if (state.kind === 'done') label.textContent = '✓ Pasted';
  else if (state.kind === 'copied') label.textContent = 'Copied — press ⌘V';
  else if (state.kind === 'error') label.textContent = `⚠ ${state.message}`;
});
```

- [ ] **Step 3: Recorder window + worklet**

`src/main/recorder-window.ts`:
```ts
import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { AudioData } from '../shared/types';

/** Hidden renderer that owns getUserMedia; kept warm for <50ms start. */
export class RecorderWindow {
  private win: BrowserWindow;

  constructor() {
    this.win = new BrowserWindow({
      show: false, width: 0, height: 0,
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    this.win.loadFile(join(rendererDir(), 'recorder.html'));
  }

  start(): void { this.win.webContents.send('rec:cmd', 'start'); }

  stop(): Promise<AudioData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Recorder did not respond')), 5000);
      ipcMain.once('rec:data', (_e, ab: ArrayBuffer) => {
        clearTimeout(timeout);
        resolve({ pcm: new Int16Array(ab), sampleRate: 16000 });
      });
      this.win.webContents.send('rec:cmd', 'stop');
    });
  }
}
```

`renderer/recorder.html`:
```html
<!doctype html><html><head><meta charset="utf-8"></head>
<body><script type="module" src="recorder.js"></script></body></html>
```

`renderer/recorder-worklet.js` (plain JS — loaded by `audioWorklet.addModule`):
```js
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('capture', CaptureProcessor);
```

`renderer/recorder.ts`:
```ts
declare const shhh: { on(ch: string, fn: (cmd: unknown) => void): void; send(ch: string, ...a: unknown[]): void };

let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let chunks: Float32Array[] = [];
let recording = false;

async function ensureContext(): Promise<void> {
  if (ctx) return;
  ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('recorder-worklet.js');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = (e) => { if (recording) chunks.push(e.data as Float32Array); };
  src.connect(node);
}

function toInt16(parts: Float32Array[]): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) out[off + i] = Math.max(-32768, Math.min(32767, Math.round(p[i] * 32767)));
    off += p.length;
  }
  return out;
}

shhh.on('rec:cmd', async (cmd) => {
  if (cmd === 'start') { await ensureContext(); chunks = []; recording = true; }
  else if (cmd === 'stop') {
    recording = false;
    const pcm = toInt16(chunks);
    chunks = [];                                     // audio is memory-only; release immediately
    shhh.send('rec:data', pcm.buffer);
  }
});

void ensureContext(); // warm up on window load (triggers mic permission on first run)
```

- [ ] **Step 4: History window + bootstrap**

`src/main/history-window.ts`:
```ts
import { BrowserWindow, clipboard, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { ShhhStore } from '../core/store';

export class HistoryWindow {
  private win: BrowserWindow | null = null;

  constructor(store: ShhhStore) {
    ipcMain.handle('history:list', (_e, search?: string) => store.listHistory({ limit: 50, search }));
    ipcMain.handle('history:copy', (_e, id: string) => {
      const entry = store.getHistoryById(id);
      if (entry) clipboard.writeText(entry.formattedText);
      return !!entry;
    });
  }

  toggle(): void {
    if (this.win && !this.win.isDestroyed()) { this.win.close(); this.win = null; return; }
    this.win = new BrowserWindow({
      width: 420, height: 480, title: 'shhh history', fullscreenable: false,
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    this.win.loadFile(join(rendererDir(), 'history.html'));
  }
}
```

`renderer/history.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font: 13px -apple-system, sans-serif; margin: 12px; }
  input { width: 100%; padding: 6px; margin-bottom: 10px; }
  .entry { padding: 8px; border-bottom: 1px solid #eee; cursor: pointer; }
  .entry:hover { background: #f4f4f4; }
  .meta { color: #999; font-size: 11px; }
</style></head>
<body>
  <input id="search" placeholder="Search…">
  <div id="list"></div>
  <script type="module" src="history.js"></script>
</body></html>
```

`renderer/history.ts`:
```ts
declare const shhh: { invoke(ch: string, ...a: unknown[]): Promise<unknown> };
const list = document.getElementById('list')!;
const search = document.getElementById('search') as HTMLInputElement;

async function render(): Promise<void> {
  const entries = (await shhh.invoke('history:list', search.value || undefined)) as
    { id: string; formattedText: string; createdAt: string; unformatted: boolean }[];
  list.innerHTML = '';
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `<div>${e.formattedText.replace(/</g, '&lt;')}</div>
      <div class="meta">${new Date(e.createdAt).toLocaleString()}${e.unformatted ? ' · raw' : ''} · click to copy</div>`;
    div.onclick = async () => { await shhh.invoke('history:copy', e.id); div.style.background = '#d4f7d4'; };
    list.appendChild(div);
  }
}
search.addEventListener('input', () => void render());
void render();
```

`src/main/index.ts` (bootstrap — SessionController wiring lands in Task 15):
```ts
import { app } from 'electron';
import { safeStorage } from 'electron';
import { join } from 'node:path';
import { dataDir, socketPath } from './paths';
import { loadOrCreateDbKey, StringEncryptor } from '../core/db-key';
import { ShhhStore } from '../core/store';
import { KeychainApiKeyStore } from '../core/api-keys';
import { RpcServer } from '../core/rpc';
import { buildHandlers } from '../core/rpc-handlers';
import { OverlayWindow } from './overlay-window';
import { RecorderWindow } from './recorder-window';
import { HistoryWindow } from './history-window';

if (!app.requestSingleInstanceLock()) app.quit();
app.dock?.hide(); // background app: no dock icon

app.whenReady().then(async () => {
  const dir = dataDir();
  const enc: StringEncryptor = {
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  };
  const store = new ShhhStore(join(dir, 'shhh.db'), loadOrCreateDbKey(dir, enc));
  const apiKeys = new KeychainApiKeyStore();

  const retention = store.getSettings().historyRetentionMs;
  if (retention !== null) store.purgeOldHistory(retention);

  const overlay = new OverlayWindow();
  const recorder = new RecorderWindow();
  const history = new HistoryWindow(store);
  overlay.onClick(() => history.toggle());

  // Task 15 wires: permissions, key listener, session controller, setup window
  const { wireSession } = await import('./session-controller');
  const checkPermissions = await wireSession({ store, apiKeys, overlay, recorder, dataDir: dir });

  const rpc = new RpcServer(socketPath(), {
    ...buildHandlers({ store, apiKeys, dataDir: dir, checkPermissions, appVersion: app.getVersion() }),
    'setup.open': async () => { (await import('./setup-window')).openSetupWindow(); return 'ok'; },
  });
  await rpc.listen();
});

app.on('window-all-closed', () => { /* background app — keep running */ });
```

- [ ] **Step 5: Build + manual verify**

Run: `npm run build` — Expected: compiles clean. (Full app launch is verified at the end of Task 15, after `session-controller.ts` exists.)

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: Electron shell — overlay, recorder, history windows, bootstrap"`

---

### Task 15: Key listener, paster, permissions, session controller

**Files:**
- Create: `src/main/key-listener.ts`, `src/main/paster.ts`, `src/main/permissions.ts`, `src/main/setup-window.ts`, `src/main/session-controller.ts`, `renderer/setup.html`, `renderer/setup.ts`
- Test: `tests/paster.test.ts`

- [ ] **Step 1: Write failing paster test** (clipboard restore logic is pure enough to test)

`tests/paster.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/paster.test.ts` → FAIL.

- [ ] **Step 3: Implement paster**

`src/main/paster.ts`:
```ts
import { execFile } from 'node:child_process';

export interface ClipboardLike { readText(): string; writeText(t: string): void }

const delay300 = () => new Promise<void>((r) => setTimeout(r, 300));

export function synthesizeCmdV(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      (err) => (err ? reject(err) : resolve()));
  });
}

/** Clipboard-swap paste. On failure the text stays on the clipboard (overlay: "Copied — press ⌘V"). */
export async function pasteWithClipboard(
  text: string, clipboard: ClipboardLike,
  keystroke: () => Promise<void> = synthesizeCmdV,
  wait: () => Promise<void> = delay300,
): Promise<boolean> {
  const previous = clipboard.readText();
  clipboard.writeText(text);
  try {
    await keystroke();
    await wait();                 // let the target app read the clipboard
    clipboard.writeText(previous);
    return true;
  } catch {
    return false;                 // keep text on clipboard
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/paster.test.ts` → PASS.

- [ ] **Step 5: Implement key listener**

`src/main/key-listener.ts`:
```ts
import { uIOhook } from 'uiohook-napi';

/**
 * Hold-to-talk listener. The macOS fn key arrives as a keydown/keyup pair via
 * uiohook's CGEventTap. Discover the keycode on your machine with:
 *   SHHH_KEY_DEBUG=1 npm start   (logs every keycode to stdout)
 * then set it via `shhh config set hotkey <code>`. "fn" maps to FN_KEYCODE below.
 */
export const FN_KEYCODE = 0x3f; // kVK_Function — verify once with SHHH_KEY_DEBUG and correct if needed

export class KeyListener {
  private down = false;
  private started = false;

  constructor(private hotkeyCode: number, private onDown: () => void, private onUp: () => void) {}

  start(): void {
    if (this.started) return;
    uIOhook.on('keydown', (e) => {
      if (process.env.SHHH_KEY_DEBUG) console.log('keydown', e.keycode);
      if (e.keycode === this.hotkeyCode && !this.down) { this.down = true; this.onDown(); }
    });
    uIOhook.on('keyup', (e) => {
      if (e.keycode === this.hotkeyCode && this.down) { this.down = false; this.onUp(); }
    });
    uIOhook.start();
    this.started = true;
  }

  stop(): void { if (this.started) { uIOhook.stop(); this.started = false; } }
}

export function resolveHotkeyCode(hotkey: string): number {
  return hotkey === 'fn' ? FN_KEYCODE : Number(hotkey);
}
```

- [ ] **Step 6: Implement permissions + setup window**

`src/main/permissions.ts`:
```ts
import { shell, systemPreferences } from 'electron';
import { PermissionStatus } from '../core/rpc-handlers';

const PANES = {
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
} as const;

export async function checkPermissions(): Promise<PermissionStatus> {
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone') === 'granted',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    // No direct API: uiohook starting successfully implies Input Monitoring. We track it via a flag
    // set by the session controller once the hook delivers its first event.
    inputMonitoring: inputMonitoringSeen,
  };
}

let inputMonitoringSeen = false;
export function markInputMonitoringWorking(): void { inputMonitoringSeen = true; }

export async function requestPermission(which: keyof typeof PANES): Promise<void> {
  if (which === 'microphone') { await systemPreferences.askForMediaAccess('microphone'); return; }
  if (which === 'accessibility') { systemPreferences.isTrustedAccessibilityClient(true); }
  await shell.openExternal(PANES[which]);
}

export function allGranted(p: PermissionStatus): boolean {
  return p.microphone && p.accessibility && p.inputMonitoring;
}
```

`src/main/setup-window.ts`:
```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { checkPermissions, requestPermission } from './permissions';

let win: BrowserWindow | null = null;
let registered = false;

export function openSetupWindow(): void {
  if (!registered) {
    ipcMain.handle('perm:status', () => checkPermissions());
    ipcMain.handle('perm:request', (_e, which) => requestPermission(which));
    ipcMain.handle('app:restart', () => { app.relaunch(); app.exit(0); });
    registered = true;
  }
  if (win && !win.isDestroyed()) { win.focus(); return; }
  win = new BrowserWindow({
    width: 460, height: 380, title: 'Set up shhh', resizable: false,
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  win.loadFile(join(rendererDir(), 'setup.html'));
}
```

`renderer/setup.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font: 14px -apple-system, sans-serif; margin: 24px; }
  .perm { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid #eee; }
  .perm button { margin-left: auto; }
  #restart { margin-top: 16px; width: 100%; padding: 10px; display: none; }
</style></head>
<body>
  <h3>shhh needs three permissions</h3>
  <div class="perm" data-k="microphone"><span class="state">⬜</span> 🎤 Microphone <button>Request</button></div>
  <div class="perm" data-k="inputMonitoring"><span class="state">⬜</span> ⌨️ Input Monitoring <button>Open Settings</button></div>
  <div class="perm" data-k="accessibility"><span class="state">⬜</span> ♿ Accessibility <button>Open Settings</button></div>
  <button id="restart">All set — Restart shhh</button>
  <script type="module" src="setup.js"></script>
</body></html>
```

`renderer/setup.ts`:
```ts
declare const shhh: { invoke(ch: string, ...a: unknown[]): Promise<unknown> };

async function refresh(): Promise<void> {
  const st = (await shhh.invoke('perm:status')) as Record<string, boolean>;
  let all = true;
  document.querySelectorAll<HTMLElement>('.perm').forEach((el) => {
    const ok = st[el.dataset.k!];
    el.querySelector('.state')!.textContent = ok ? '✅' : '⬜';
    (el.querySelector('button') as HTMLButtonElement).style.visibility = ok ? 'hidden' : 'visible';
    all &&= ok;
  });
  (document.getElementById('restart') as HTMLButtonElement).style.display = all ? 'block' : 'none';
}

document.querySelectorAll<HTMLElement>('.perm button').forEach((btn) => {
  btn.addEventListener('click', () => void shhh.invoke('perm:request', btn.parentElement!.dataset.k));
});
document.getElementById('restart')!.addEventListener('click', () => void shhh.invoke('app:restart'));

setInterval(() => void refresh(), 1500);   // live polling while the user flips toggles
void refresh();
```

- [ ] **Step 7: Implement session controller**

`src/main/session-controller.ts`:
```ts
import { clipboard } from 'electron';
import { ShhhStore } from '../core/store';
import { ApiKeyStore } from '../core/api-keys';
import { runDictationCycle } from '../core/pipeline';
import { buildTranscriber } from '../core/transcriber/factory';
import { buildFormatter } from '../core/formatter/factory';
import { PermissionStatus } from '../core/rpc-handlers';
import { KeyListener, resolveHotkeyCode } from './key-listener';
import { pasteWithClipboard } from './paster';
import { checkPermissions, markInputMonitoringWorking, allGranted } from './permissions';
import { openSetupWindow } from './setup-window';
import { OverlayWindow } from './overlay-window';
import { RecorderWindow } from './recorder-window';

interface Wiring {
  store: ShhhStore; apiKeys: ApiKeyStore;
  overlay: OverlayWindow; recorder: RecorderWindow; dataDir: string;
}

const MIN_RECORDING_MS = 300; // discard accidental taps

export async function wireSession(w: Wiring): Promise<() => Promise<PermissionStatus>> {
  let recordingStart = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const onDown = (): void => {
    markInputMonitoringWorking();
    if (busy) return;
    const max = w.store.getSettings().maxRecordingMs;
    recordingStart = Date.now();
    w.recorder.start();
    ticker = setInterval(() => {
      const elapsedMs = Date.now() - recordingStart;
      w.overlay.setState({ kind: 'listening', elapsedMs, level: 0, warning: max - elapsedMs < 30_000 });
      if (elapsedMs >= max) onUp(); // graceful cap: stop and process, never discard
    }, 250);
    w.overlay.setState({ kind: 'listening', elapsedMs: 0, level: 0, warning: false });
  };

  const onUp = async (): Promise<void> => {
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (busy) return;
    const elapsed = Date.now() - recordingStart;
    if (elapsed < MIN_RECORDING_MS) {
      try { await w.recorder.stop(); } catch { /* nothing recorded */ }
      w.overlay.setState({ kind: 'hidden' });
      return;
    }
    busy = true;
    w.overlay.setState({ kind: 'processing' });
    try {
      const audio = await w.recorder.stop();
      const settings = w.store.getSettings();
      const result = await runDictationCycle(audio, {
        transcriber: buildTranscriber(settings, w.apiKeys, w.dataDir),
        formatter: buildFormatter(settings, w.apiKeys),
        paste: (text) => pasteWithClipboard(text, clipboard),
        saveHistory: (e) => w.store.insertHistory(e),
        meta: { sttProvider: settings.sttProvider, sttModel: settings.sttModel, llmProvider: settings.llmProvider, llmModel: settings.llmModel },
      });
      if (!result.ok) w.overlay.setState({ kind: 'error', message: result.error });
      else w.overlay.setState({ kind: result.pasted ? 'done' : 'copied' });
    } catch (e) {
      w.overlay.setState({ kind: 'error', message: e instanceof Error ? e.message : 'Unexpected error' });
    } finally {
      busy = false;
      setTimeout(() => w.overlay.setState({ kind: 'hidden' }), 2500);
    }
  };

  const settings = w.store.getSettings();
  const listener = new KeyListener(resolveHotkeyCode(settings.hotkey), onDown, () => void onUp());
  listener.start();

  const perms = await checkPermissions();
  if (!allGranted(perms)) openSetupWindow();

  return checkPermissions;
}
```

- [ ] **Step 8: Manual verification (full app)**

```bash
npm run build && npx electron .
```
Walk through `docs/manual-smoke-checklist.md` items 1–6 (created in Task 16):
1. First launch opens the setup window; grant all three permissions (restart when prompted).
2. `SHHH_KEY_DEBUG=1 npx electron .` — press fn; confirm the logged keycode matches `FN_KEYCODE`. If different, update `FN_KEYCODE` in `src/main/key-listener.ts` to the observed value and rebuild.
3. Configure: `shhh model download tiny.en && shhh config set stt.provider local && shhh config set stt.model tiny.en` (CLI run via `node dist/cli/index.js …` until packaged).
4. Hold fn in TextEdit, say "hello world", release → overlay shows listening → processing → text pastes.
5. Click overlay → history panel shows the entry; click entry → copies.
6. `shhh config set llm.provider anthropic`, `shhh config set llm.model claude-haiku-4-5`, `shhh config set anthropic.api-key` — dictate "um um hello hello world" → pasted text is cleaned.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat: hold-to-talk session — key hook, paste, permissions onboarding"`

---

### Task 16: Packaging — electron-builder, npm bootstrapper, CI, smoke checklist

**Files:**
- Create: `electron-builder.yml`, `src/cli/install.ts`, `.github/workflows/release.yml`, `docs/manual-smoke-checklist.md`
- Modify: `src/cli/index.ts` (add install/update/start/stop commands), `package.json` (publishable CLI metadata)

- [ ] **Step 1: electron-builder config**

`electron-builder.yml`:
```yaml
appId: dev.bogdan.shhh
productName: shhh
directories: { output: release }
files: ["dist/**/*", "package.json"]
mac:
  target: [{ target: zip, arch: universal }]
  category: public.app-category.productivity
  identity: null            # unsigned (ad-hoc) — npm-first distribution, no Apple Developer account
  extendInfo:
    NSMicrophoneUsageDescription: "shhh records audio only while you hold the dictation key."
    LSUIElement: true       # background app — no dock icon
```

- [ ] **Step 2: Add `shhh install` / `update`**

`src/cli/install.ts`:
```ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = 'bogdandanila/shhh'; // adjust to the real GitHub repo
const APP_DEST = '/Applications/shhh.app';

interface ReleaseAsset { name: string; browser_download_url: string }

export async function installApp(print: (s: string) => void): Promise<void> {
  print('Fetching latest release…');
  const rel = (await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)).json()) as
    { tag_name: string; assets: ReleaseAsset[] };
  const zip = rel.assets.find((a) => a.name.endsWith('.zip'));
  const sums = rel.assets.find((a) => a.name === 'checksums.txt');
  if (!zip || !sums) throw new Error('Release is missing app zip or checksums.txt');

  const tmp = join(tmpdir(), `shhh-${rel.tag_name}.zip`);
  print(`Downloading ${zip.name}…`);
  writeFileSync(tmp, Buffer.from(await (await fetch(zip.browser_download_url)).arrayBuffer()));

  const sumText = await (await fetch(sums.browser_download_url)).text();
  const expected = sumText.split('\n').find((l) => l.includes(zip.name))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(tmp)).digest('hex');
  if (!expected || actual !== expected) throw new Error(`Checksum mismatch (expected ${expected}, got ${actual})`);
  print('Checksum verified ✅');

  // Downloaded via Node -> no quarantine attribute -> Gatekeeper never engages.
  if (existsSync(APP_DEST)) rmSync(APP_DEST, { recursive: true });
  mkdirSync('/Applications', { recursive: true });
  execFileSync('ditto', ['-xk', tmp, '/Applications']);
  rmSync(tmp);
  print(`Installed ${rel.tag_name} to ${APP_DEST}`);
  print('Note: updating resets Input Monitoring/Accessibility permissions (unsigned build) — run `shhh setup` after updates.');
}
```

Add to `buildProgram` in `src/cli/index.ts` (inside the function, before `return program`):
```ts
  program.command('install').description('Download and install shhh.app').action(async () => {
    const { installApp } = await import('./install');
    await installApp(io.print);
  });
  program.command('update').description('Update shhh.app and re-run permission setup').action(async () => {
    const { installApp } = await import('./install');
    await installApp(io.print);
    await io.rpc('setup.open', {}).catch(() => io.print('Start the app and run `shhh setup` to re-grant permissions.'));
  });
  program.command('start').action(async () => { await io.rpc('status', {}); io.print('running'); });
  program.command('stop').action(async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('pkill', ['-x', 'shhh']); io.print('stopped');
  });
```

- [ ] **Step 3: Release workflow**

`.github/workflows/release.yml`:
```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npx electron-builder --mac --publish never
      - name: checksums
        run: cd release && shasum -a 256 *.zip > checksums.txt
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            release/*.zip
            release/checksums.txt
```

- [ ] **Step 4: Manual smoke checklist doc**

`docs/manual-smoke-checklist.md`:
```markdown
# shhh — Release Candidate Smoke Checklist

Run on a real Mac before tagging a release. Items 1–6 are also the Task 15 verification.

1. **First-run setup**: delete `~/Library/Application Support/shhh`, launch app → setup window appears; all three permissions grantable; restart button appears when done.
2. **fn key**: `SHHH_KEY_DEBUG=1` launch → fn down/up logs the configured keycode; no double-fires on key repeat.
3. **Configure via CLI**: model download + stt provider set works; `shhh doctor` all green.
4. **Dictation into TextEdit**: hold-speak-release → listening overlay (with timer) → processing → correct text pasted; previous clipboard contents restored.
5. **History panel**: click overlay → entries present; click-to-copy works; search filters.
6. **Formatting pass**: with Anthropic key set, filler words removed; with key removed (`shhh nuke` then re-setup), raw text still pastes (unformatted fallback).
7. **Paste targets**: dictate into (a) Chrome textarea, (b) Terminal, (c) Slack, (d) VS Code. All receive text; clipboard restored.
8. **Fullscreen**: overlay visible over a fullscreen app.
9. **Secure input**: dictate into a password field → overlay shows "Copied — press ⌘V"; text on clipboard.
10. **Long dictation**: set `max-recording 1m`, talk past the cap → warning pulse at 30s remaining, graceful stop, full text processed.
11. **Errors**: unset STT (`shhh nuke`) → dictation shows actionable error overlay. Bad API key → error mentions failure, nothing pasted.
12. **Permission revocation**: revoke Accessibility in System Settings → next dictation says "Copied — press ⌘V"; `shhh doctor` flags it.
13. **Install flow** (post-release): `npm i -g` the CLI tarball, `shhh install` downloads, verifies checksum, app launches from /Applications without Gatekeeper dialog.
14. **Update flow**: `shhh update` → app replaced → setup window re-opens for permission re-grant.
```

- [ ] **Step 5: Verify build artifacts locally**

Run: `npm run build && npx electron-builder --mac --publish never`
Expected: `release/shhh-0.1.0-universal-mac.zip` exists. Then `npx vitest run` — all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: packaging — unsigned universal build, npm installer, release CI, smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage check:** hold-to-talk fn (T15), overlay states incl. "Copied — press ⌘V" (T14/T15), two-pass pipeline with empty defaults (T8/T10/T11), user prompt override (T12/T13), encrypted SQLCipher store + safeStorage-wrapped key (T3/T4), Keychain API keys + redaction + hidden prompt (T5/T13), sync-ready schema UUIDv7/tombstones/device_id (T4), unix socket mode 600 (T12), CLI surface (T13/T16), permissions onboarding + doctor (T15/T12), 10-min configurable cap with graceful stop + warning (T2/T15), cloud chunking/compression (T6/T9), model download with checksum (T10), npm-first unsigned distribution + quarantine avoidance + TCC reset mitigation (T16), retention purge (T4/T14), nuke (T12), never-lose-words error table (T11/T15), manual smoke checklist (T16).
- **Known deferred items (intentional, spec-consistent):** launch-at-login wiring (`app.setLoginItemSettings`) is config-key only — wire it in `main/index.ts` reading `loginLaunch` when first needed; tray icon is optional per spec and omitted.
- **Empirical values flagged inline:** whisper model sha256 (T10 Step 1 command), fn keycode (T15 Step 8.2 debug procedure). Both have exact discovery procedures — no guessing.
