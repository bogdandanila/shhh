# Home Window (consolidated UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shhh's separate setup/history windows with one consolidated home window (Home / History / Settings sidebar) that is reachable independently of the menu-bar tray and is the primary surface for status, history, and all configuration.

**Architecture:** A single Electron `BrowserWindow` rendered by `renderer/home.html` + ES-module renderer code, with a sidebar that swaps between three client-side views. Main-process IPC handlers (existing `perm:*`/`stt:*`/`llm:*`/`history:*` plus new `app:*`/`config:*`/`prompt:*`) all delegate to the same `ShhhStore` the CLI uses. Re-launching the app surfaces the window (`second-instance`/`activate`), so it works even when the tray icon is hidden under the notch.

**Tech Stack:** TypeScript, Electron 33, vitest. Renderer is ES2022 modules (`tsconfig.renderer.json`), main is CommonJS. Native modules: leave on whichever ABI is active; run `npm run rebuild:node` before `npm test` and `npm run rebuild:electron` before `npx electron .`.

---

## File Structure

**New:**
- `src/core/status.ts` — pure helpers: `isSttConfigured`, `isLlmConfigured`, `buildAppStatus`. Tested.
- `src/main/home-window.ts` — owns the single home `BrowserWindow` (create/show/focus/hide/nav) and registers all renderer IPC.
- `renderer/home.html` — sidebar shell + three `<section>` containers.
- `renderer/home.css` — layout for sidebar + views.
- `renderer/home.ts` — nav controller; imports and initializes the three view modules.
- `renderer/views/home.ts` — dashboard view (polls `app:status`).
- `renderer/views/history.ts` — history list view (migrated from `renderer/history.ts`).
- `renderer/views/settings.ts` — settings view (migrated from `renderer/setup.ts` + Preferences + prompt editor).
- `tests/status.test.ts` — unit tests for `src/core/status.ts`.

**Modified:**
- `src/main/session-controller.ts` — `wireSession` returns `{ checkPermissions, setHotkey }`; listener becomes rebuildable; drop the `openSetupWindow` call.
- `src/main/index.ts` — instantiate home window; `second-instance`/`activate` show it; first-run shows Settings; tray deep-links; overlay click → history; `setup.open` RPC → home Settings; sync login item.
- `src/main/tray.ts` — deep-link callbacks (`onHome`/`onHistory`/`onSettings`/`onCheckUpdates`/`onQuit`).
- `src/main/preload.ts` — extend `ALLOWED_INVOKE`/`ALLOWED_ON`.
- `src/cli/index.ts` (only if it references setup wording) — unchanged behavior; `setup` still calls `setup.open` RPC.
- `scripts/copy-assets.mjs` — copy `home.html`/`home.css`; drop `setup.html`/`history.html`.
- `docs/manual-smoke-checklist.md` — new items.

**Deleted:**
- `src/main/setup-window.ts`, `src/main/history-window.ts`
- `renderer/setup.html`, `renderer/setup.ts`, `renderer/history.html`, `renderer/history.ts`

---

## Task 1: Pure status helpers

**Files:**
- Create: `src/core/status.ts`
- Test: `tests/status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/status.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/status.test.ts`
Expected: FAIL — cannot find module `../src/core/status`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/status.ts
import { Settings } from '../shared/types';

export interface PermissionFlags { microphone: boolean; accessibility: boolean }

export interface AppStatus {
  version: string;
  hotkey: string;
  stt: { provider: string; model: string; configured: boolean };
  llm: { provider: string; model: string; configured: boolean };
  permissions: PermissionFlags;
  ready: boolean; // permissions granted AND STT usable — i.e. dictation will work
}

/** STT is usable when a provider+model is chosen and its backing resource exists
 *  (local model file present, or cloud API key present). Mirrors buildTranscriber. */
export function isSttConfigured(settings: Settings, deps: { modelPresent: boolean; keyPresent: boolean }): boolean {
  if (settings.sttProvider === 'unset' || !settings.sttModel) return false;
  return settings.sttProvider === 'local' ? deps.modelPresent : deps.keyPresent;
}

/** Formatting is usable when a provider+model is chosen and its API key is present. Mirrors buildFormatter. */
export function isLlmConfigured(settings: Settings, deps: { keyPresent: boolean }): boolean {
  if (settings.llmProvider === 'none' || !settings.llmModel) return false;
  return deps.keyPresent;
}

export function buildAppStatus(args: {
  settings: Settings;
  version: string;
  permissions: PermissionFlags;
  sttModelPresent: boolean;
  sttKeyPresent: boolean;
  llmKeyPresent: boolean;
}): AppStatus {
  const stt = isSttConfigured(args.settings, { modelPresent: args.sttModelPresent, keyPresent: args.sttKeyPresent });
  const llm = isLlmConfigured(args.settings, { keyPresent: args.llmKeyPresent });
  return {
    version: args.version,
    hotkey: args.settings.hotkey,
    stt: { provider: args.settings.sttProvider, model: args.settings.sttModel, configured: stt },
    llm: { provider: args.settings.llmProvider, model: args.settings.llmModel, configured: llm },
    permissions: args.permissions,
    ready: args.permissions.microphone && args.permissions.accessibility && stt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/status.ts tests/status.test.ts
git commit -m "feat: pure app-status helpers (stt/llm configured, dashboard shape)"
```

---

## Task 2: Rebuildable hotkey listener + setHotkey

**Files:**
- Modify: `src/main/session-controller.ts`

- [ ] **Step 1: Make the listener rebuildable and return setHotkey**

Replace the block from `const settings = w.store.getSettings();` (line ~82) through the end of the function (`return checkPermissions;` and its closing brace) with:

```ts
  const buildListener = (hotkey: string): KeyListener => {
    let code: number;
    try {
      code = resolveHotkeyCode(hotkey);
    } catch (e) {
      console.warn(`${e instanceof Error ? e.message : e} — falling back to ${DEFAULT_HOTKEY}`);
      code = resolveHotkeyCode(DEFAULT_HOTKEY);
    }
    return new KeyListener(code, onDown, () => void onUp());
  };

  const settings = w.store.getSettings();
  let trusted = false;
  let listener = buildListener(settings.hotkey);

  // NSEvent monitors installed before Accessibility is granted never fire, so
  // install the moment the app becomes trusted — no restart needed.
  const startWhenTrusted = (): boolean => {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) return false;
    trusted = true;
    listener.start();
    return true;
  };
  if (!startWhenTrusted()) {
    const poll = setInterval(() => { if (startWhenTrusted()) clearInterval(poll); }, 2000);
  }

  // Rebind the hotkey at runtime when the user changes it in the UI.
  const setHotkey = (hotkey: string): void => {
    listener.stop();
    listener = buildListener(hotkey);
    if (trusted) listener.start();
  };

  return { checkPermissions, setHotkey };
}
```

- [ ] **Step 2: Update the return type and drop the setup-window dependency**

Change the function signature line (line ~23) from:

```ts
export async function wireSession(w: Wiring): Promise<() => Promise<PermissionStatus>> {
```

to:

```ts
export interface SessionHandle {
  checkPermissions: () => Promise<PermissionStatus>;
  setHotkey: (hotkey: string) => void;
}

export async function wireSession(w: Wiring): Promise<SessionHandle> {
```

Remove the now-unused import line:

```ts
import { openSetupWindow } from './setup-window';
```

and remove the unused `buildTranscriber`/`allGranted`/`checkPermissions`-for-first-run usage that was in the deleted tail (the `const perms = await checkPermissions(); const sttReady = ...; if (...) openSetupWindow(...)` lines are gone as part of Step 1). Keep the `checkPermissions` and `allGranted` imports only if still referenced — after this change `allGranted` is no longer used here, so remove `allGranted` from the import on line 11, leaving `import { checkPermissions } from './permissions';`. `buildTranscriber` is still used inside `onUp`, keep it.

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: ends with `ok ../dist/cli/index.js` and no TS errors. (First-run window opening now lives in index.ts — Task 7 — so a temporary "unused import" in index.ts is fine until then; if `npm run build` fails on index.ts, that's expected and resolved in Task 7. To keep this task self-contained, only assert that `src/main/session-controller.ts` itself has no errors: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep session-controller` should print nothing.)

- [ ] **Step 4: Commit**

```bash
git add src/main/session-controller.ts
git commit -m "feat: rebuildable key listener — wireSession returns setHotkey for live hotkey changes"
```

---

## Task 3: Home window — main process (lifecycle + IPC)

**Files:**
- Create: `src/main/home-window.ts`

This module owns the single window and registers every renderer IPC handler (the `stt:*`/`llm:*`/`perm:*` handlers are moved here verbatim from the soon-deleted `setup-window.ts`; `history:*` from `history-window.ts`).

- [ ] **Step 1: Write the full module**

```ts
// src/main/home-window.ts
import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { ShhhStore } from '../core/store';
import { ApiKeyStore, KeyProvider } from '../core/api-keys';
import { LlmProvider, SttProvider } from '../shared/types';
import { WHISPER_MODELS, WhisperModelName, isModelPresent, downloadModel } from '../core/models';
import { DEFAULT_SYSTEM_PROMPT } from '../core/formatter/default-prompt';
import { parseDuration, formatDuration } from '../core/settings';
import { buildAppStatus } from '../core/status';
import { resolveHotkeyCode } from './key-listener';
import { checkPermissions, requestPermission } from './permissions';

export type Section = 'home' | 'history' | 'settings';

export interface HomeDeps {
  store: ShhhStore;
  apiKeys: ApiKeyStore;
  dataDir: string;
  setHotkey: (hotkey: string) => void;
  checkUpdates: () => void;
}

const CLOUD_STT: SttProvider[] = ['openai', 'groq', 'deepgram'];
const LLM_CLOUD: LlmProvider[] = ['anthropic', 'openai'];

let win: BrowserWindow | null = null;
let deps: HomeDeps | null = null;
let registered = false;
let quitting = false;

export function initHomeWindow(d: HomeDeps): void {
  deps = d;
  if (!registered) {
    registerIpc();
    app.on('before-quit', () => { quitting = true; });
    registered = true;
  }
}

export function showHome(section: Section = 'home'): void {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 760, height: 580, minWidth: 640, minHeight: 480, title: 'shhh',
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    win.loadFile(join(rendererDir(), 'home.html'));
    win.webContents.once('did-finish-load', () => win?.webContents.send('nav', section));
    // Background app: closing hides the window; only an explicit Quit exits.
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });
  } else {
    win.webContents.send('nav', section);
  }
  win.show();
  win.focus();
  app.focus({ steal: true });
}

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function registerIpc(): void {
  const d = (): HomeDeps => deps!;

  // ---- Permissions ----
  let lastPerms: { microphone: boolean; accessibility: boolean } | null = null;
  ipcMain.handle('perm:status', async () => {
    const p = await checkPermissions();
    // A grant lands after a Settings round-trip that buried the window — resurface it.
    const granted = lastPerms && ((p.microphone && !lastPerms.microphone) || (p.accessibility && !lastPerms.accessibility));
    lastPerms = p;
    if (granted && win && !win.isDestroyed()) { app.focus({ steal: true }); win.focus(); }
    return p;
  });
  ipcMain.handle('perm:request', async (_e, which) => {
    await requestPermission(which);
    if (which === 'microphone' && win && !win.isDestroyed()) { app.focus({ steal: true }); win.focus(); }
  });

  // ---- Speech-to-text ----
  ipcMain.handle('stt:status', () => {
    const s = d().store.getSettings();
    const configured = s.sttProvider !== 'unset' && !!s.sttModel && (
      s.sttProvider === 'local' ? isModelPresent(d().dataDir, s.sttModel) : d().apiKeys.get(s.sttProvider as KeyProvider) !== null
    );
    return {
      provider: s.sttProvider, model: s.sttModel, configured,
      localModels: (Object.keys(WHISPER_MODELS) as WhisperModelName[]).map((name) => ({
        name, sizeMB: WHISPER_MODELS[name].sizeMB, present: isModelPresent(d().dataDir, name),
      })),
    };
  });
  ipcMain.handle('stt:useLocal', async (_e, model: string) => {
    if (!(model in WHISPER_MODELS)) throw new Error(`Unknown model: ${model}`);
    if (!isModelPresent(d().dataDir, model)) {
      await downloadModel(d().dataDir, model as WhisperModelName, (pct) => send('stt:progress', pct));
    }
    d().store.patchSettings({ sttProvider: 'local', sttModel: model });
    return 'ok';
  });
  ipcMain.handle('stt:useCloud', (_e, p: { provider: string; model: string; apiKey: string }) => {
    if (!CLOUD_STT.includes(p.provider as SttProvider)) throw new Error(`Unknown provider: ${p.provider}`);
    const model = p.model.trim(), apiKey = p.apiKey.trim();
    if (!model || !apiKey) throw new Error('Model and API key are required');
    d().apiKeys.set(p.provider as KeyProvider, apiKey);
    d().store.patchSettings({ sttProvider: p.provider as SttProvider, sttModel: model });
    return 'ok';
  });

  // ---- Formatting (LLM) ----
  ipcMain.handle('llm:status', () => {
    const s = d().store.getSettings();
    return {
      provider: s.llmProvider, model: s.llmModel,
      configured: s.llmProvider !== 'none' && !!s.llmModel && d().apiKeys.get(s.llmProvider as KeyProvider) !== null,
    };
  });
  ipcMain.handle('llm:set', (_e, p: { provider: string; model: string; apiKey: string }) => {
    if (!LLM_CLOUD.includes(p.provider as LlmProvider)) throw new Error(`Unknown provider: ${p.provider}`);
    const model = p.model.trim(), apiKey = p.apiKey.trim();
    if (!model || !apiKey) throw new Error('Model and API key are required');
    d().apiKeys.set(p.provider as KeyProvider, apiKey);
    d().store.patchSettings({ llmProvider: p.provider as LlmProvider, llmModel: model });
    return 'ok';
  });
  ipcMain.handle('llm:disable', () => {
    d().store.patchSettings({ llmProvider: 'none', llmModel: '' });
    return 'ok';
  });

  // ---- History ----
  ipcMain.handle('history:list', (_e, search?: string) => d().store.listHistory({ limit: 50, search }));
  ipcMain.handle('history:copy', (_e, id: string) => {
    const entry = d().store.getHistoryById(id);
    if (entry) clipboard.writeText(entry.formattedText);
    return !!entry;
  });

  // ---- Preferences (config) ----
  ipcMain.handle('config:get', () => {
    const s = d().store.getSettings();
    return {
      hotkey: s.hotkey,
      duckAudio: s.duckAudio,
      maxRecording: formatDuration(s.maxRecordingMs),
      historyRetention: s.historyRetentionMs === null ? 'off' : formatDuration(s.historyRetentionMs),
      loginLaunch: s.loginLaunch,
    };
  });
  ipcMain.handle('config:set', (_e, key: string, value: unknown) => {
    const store = d().store;
    switch (key) {
      case 'hotkey':
        resolveHotkeyCode(String(value)); // throws on an invalid hotkey before persisting
        store.patchSettings({ hotkey: String(value) });
        d().setHotkey(String(value));
        break;
      case 'duckAudio':
        store.patchSettings({ duckAudio: !!value });
        break;
      case 'maxRecording':
        store.patchSettings({ maxRecordingMs: parseDuration(String(value)) });
        break;
      case 'historyRetention':
        store.patchSettings({ historyRetentionMs: value === 'off' ? null : parseDuration(String(value)) });
        break;
      case 'loginLaunch':
        store.patchSettings({ loginLaunch: !!value });
        app.setLoginItemSettings({ openAtLogin: !!value });
        break;
      default:
        throw new Error(`Unknown setting: ${key}`);
    }
    return 'ok';
  });

  // ---- Formatting system prompt ----
  ipcMain.handle('prompt:get', () => d().store.getSettings().systemPrompt);
  ipcMain.handle('prompt:set', (_e, prompt: string) => { d().store.patchSettings({ systemPrompt: prompt }); return 'ok'; });
  ipcMain.handle('prompt:reset', () => { d().store.patchSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT }); return DEFAULT_SYSTEM_PROMPT; });

  // ---- App ----
  ipcMain.handle('app:status', async () => {
    const s = d().store.getSettings();
    const perms = await checkPermissions();
    const sttKeyPresent = s.sttProvider !== 'local' && s.sttProvider !== 'unset'
      ? d().apiKeys.get(s.sttProvider as KeyProvider) !== null : false;
    const llmKeyPresent = s.llmProvider !== 'none' ? d().apiKeys.get(s.llmProvider as KeyProvider) !== null : false;
    return buildAppStatus({
      settings: s, version: app.getVersion(), permissions: perms,
      sttModelPresent: s.sttProvider === 'local' && isModelPresent(d().dataDir, s.sttModel),
      sttKeyPresent, llmKeyPresent,
    });
  });
  ipcMain.handle('app:checkUpdates', () => d().checkUpdates());
  ipcMain.handle('app:quit', () => app.quit());
}
```

- [ ] **Step 2: Build to verify it compiles** (renderer/index wiring comes later)

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep home-window`
Expected: no output (no errors in this file).

- [ ] **Step 3: Commit**

```bash
git add src/main/home-window.ts
git commit -m "feat: home-window main process — single window + consolidated IPC"
```

---

## Task 4: Preload allowlist

**Files:**
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Extend the allowlists**

Replace the two constant lines at the top of `src/main/preload.ts` with:

```ts
const ALLOWED_INVOKE = [
  'history:list', 'history:copy',
  'perm:status', 'perm:request',
  'stt:status', 'stt:useLocal', 'stt:useCloud',
  'llm:status', 'llm:set', 'llm:disable',
  'config:get', 'config:set',
  'prompt:get', 'prompt:set', 'prompt:reset',
  'app:status', 'app:checkUpdates', 'app:quit',
];
const ALLOWED_ON = ['overlay:state', 'rec:cmd', 'stt:progress', 'nav'];
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no TS errors from preload. (index.ts may still error until Task 7 — acceptable; verify preload specifically with `npx tsc -p tsconfig.json --noEmit 2>&1 | grep preload` printing nothing.)

- [ ] **Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat: preload — allow home-window IPC channels"
```

---

## Task 5: Renderer shell (home.html / home.css / home.ts)

**Files:**
- Create: `renderer/home.html`, `renderer/home.css`, `renderer/home.ts`

- [ ] **Step 1: Write `renderer/home.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="home.css"></head>
<body>
  <nav id="sidebar">
    <div class="brand">🤫 shhh</div>
    <button class="navbtn" data-section="home">Home</button>
    <button class="navbtn" data-section="history">History</button>
    <button class="navbtn" data-section="settings">Settings</button>
  </nav>
  <main>
    <section id="view-home" class="view"></section>
    <section id="view-history" class="view hidden"></section>
    <section id="view-settings" class="view hidden"></section>
  </main>
  <script type="module" src="home.js"></script>
</body></html>
```

- [ ] **Step 2: Write `renderer/home.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font: 14px -apple-system, sans-serif; display: flex; height: 100vh; color: #1d1d1f; }
#sidebar { width: 150px; flex: 0 0 150px; background: #f5f5f7; border-right: 1px solid #e0e0e0; padding: 16px 8px; display: flex; flex-direction: column; gap: 4px; }
.brand { font-weight: 600; padding: 4px 8px 12px; }
.navbtn { text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 6px; font: inherit; cursor: pointer; }
.navbtn:hover { background: #e8e8ed; }
.navbtn.active { background: #007aff; color: #fff; }
main { flex: 1; overflow-y: auto; padding: 24px; }
.view.hidden { display: none; }
h3 { margin: 0 0 4px; }
.group { margin-top: 22px; }
.row { padding: 8px 0; display: flex; align-items: center; gap: 10px; }
.row label.name { min-width: 130px; }
button.action { padding: 6px 12px; border-radius: 6px; border: 1px solid #c7c7cc; background: #fff; cursor: pointer; font: inherit; }
button.primary { background: #007aff; color: #fff; border-color: #007aff; }
.err { color: #c00; min-height: 1.2em; font-size: 12px; }
.note { color: #888; font-size: 12px; }
.status-dot { color: #34c759; }
input[type=text], input[type=password], select, textarea { font: inherit; padding: 5px 8px; border: 1px solid #c7c7cc; border-radius: 6px; }
textarea { width: 100%; min-height: 120px; resize: vertical; }
```

- [ ] **Step 3: Write `renderer/home.ts` (nav controller)**

```ts
import { initHomeView } from './views/home.js';
import { initHistoryView } from './views/history.js';
import { initSettingsView } from './views/settings.js';

interface ShhhBridge {
  invoke(ch: string, ...a: unknown[]): Promise<unknown>;
  on(ch: string, fn: (...a: unknown[]) => void): void;
}
declare const shhh: ShhhBridge;

type Section = 'home' | 'history' | 'settings';

const home = initHomeView();
const history = initHistoryView();
const settings = initSettingsView();

function show(section: Section): void {
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${section}`)!.classList.remove('hidden');
  document.querySelectorAll<HTMLElement>('.navbtn').forEach((b) =>
    b.classList.toggle('active', b.dataset.section === section));
  if (section === 'home') void home.refresh();
  if (section === 'history') void history.refresh();
  if (section === 'settings') void settings.refresh();
}

document.querySelectorAll<HTMLElement>('.navbtn').forEach((b) =>
  b.addEventListener('click', () => show(b.dataset.section as Section)));

shhh.on('nav', (section) => show((section as Section) ?? 'home'));

show('home');
export {};
```

- [ ] **Step 4: Build to verify the shell compiles** (views come in Tasks 6-8; expect missing-module errors only for `./views/*`)

Run: `npx tsc -p tsconfig.renderer.json --noEmit 2>&1 | grep "home.ts"`
Expected: errors referencing `./views/home.js` etc. (resolved in the next tasks). No other errors.

- [ ] **Step 5: Commit**

```bash
git add renderer/home.html renderer/home.css renderer/home.ts
git commit -m "feat: home window renderer shell + sidebar nav"
```

---

## Task 6: Dashboard view (views/home.ts)

**Files:**
- Create: `renderer/views/home.ts`

- [ ] **Step 1: Write the dashboard view**

```ts
interface ShhhBridge { invoke(ch: string, ...a: unknown[]): Promise<unknown> }
declare const shhh: ShhhBridge;

interface AppStatus {
  version: string; hotkey: string; ready: boolean;
  stt: { provider: string; model: string; configured: boolean };
  llm: { provider: string; model: string; configured: boolean };
  permissions: { microphone: boolean; accessibility: boolean };
}

export function initHomeView(): { refresh: () => Promise<void> } {
  const root = document.getElementById('view-home')!;
  root.innerHTML = `
    <h3>shhh</h3>
    <p id="run-state"><span class="status-dot">●</span> Running</p>
    <div class="group">
      <div class="row"><label class="name">Hotkey</label><span id="d-hotkey"></span></div>
      <div class="row"><label class="name">Speech-to-text</label><span id="d-stt"></span></div>
      <div class="row"><label class="name">Formatting</label><span id="d-llm"></span></div>
    </div>
    <p id="d-banner" class="note"></p>
    <div class="group row">
      <button class="action" id="d-update">Check for Updates…</button>
      <button class="action" id="d-quit">Quit shhh</button>
    </div>
    <p class="note">shhh <span id="d-version"></span></p>`;

  root.querySelector<HTMLButtonElement>('#d-update')!.addEventListener('click', () => void shhh.invoke('app:checkUpdates'));
  root.querySelector<HTMLButtonElement>('#d-quit')!.addEventListener('click', () => void shhh.invoke('app:quit'));

  async function refresh(): Promise<void> {
    const st = (await shhh.invoke('app:status')) as AppStatus;
    const hotkeyLabel = st.hotkey === 'fn' ? 'fn (🌐)' : st.hotkey;
    root.querySelector('#d-hotkey')!.textContent = `Hold ${hotkeyLabel}`;
    root.querySelector('#d-stt')!.textContent = st.stt.configured
      ? `${st.stt.provider === 'local' ? 'Local Whisper' : st.stt.provider} (${st.stt.model})`
      : 'Not configured';
    root.querySelector('#d-llm')!.textContent = st.llm.configured ? `${st.llm.provider} (${st.llm.model})` : 'Off (raw transcription)';
    root.querySelector('#d-version')!.textContent = `v${st.version}`;
    const needs = !st.permissions.microphone || !st.permissions.accessibility || !st.stt.configured;
    root.querySelector('#d-banner')!.textContent = needs ? '⚠️ Setup incomplete — open Settings to finish.' : '';
  }

  return { refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/views/home.ts
git commit -m "feat: home dashboard view (status + check updates + quit)"
```

---

## Task 7: History view (views/history.ts)

**Files:**
- Create: `renderer/views/history.ts`

This migrates `renderer/history.ts` (which renders into a fixed list) into a view module that renders its own DOM and exposes `refresh()`.

- [ ] **Step 1: Write the history view**

```ts
interface ShhhBridge { invoke(ch: string, ...a: unknown[]): Promise<unknown> }
declare const shhh: ShhhBridge;

interface HistoryEntry { id: string; formattedText: string; createdAt: string; unformatted: boolean }

export function initHistoryView(): { refresh: () => Promise<void> } {
  const root = document.getElementById('view-history')!;
  root.innerHTML = `
    <h3>History</h3>
    <input type="text" id="h-search" placeholder="Search…" style="width:100%;margin:8px 0">
    <div id="h-list"></div>`;
  const search = root.querySelector<HTMLInputElement>('#h-search')!;
  const list = root.querySelector<HTMLDivElement>('#h-list')!;

  async function refresh(): Promise<void> {
    const entries = (await shhh.invoke('history:list', search.value || undefined)) as HistoryEntry[];
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = search.value ? 'No matches.' : 'No dictations yet.';
      list.appendChild(empty);
      return;
    }
    for (const e of entries) {
      const div = document.createElement('div');
      div.className = 'entry';
      div.style.cssText = 'padding:8px 0;border-bottom:1px solid #eee;cursor:pointer';
      const text = document.createElement('div');
      text.textContent = e.formattedText;
      const meta = document.createElement('div');
      meta.className = 'note';
      meta.textContent = `${new Date(e.createdAt).toLocaleString()}${e.unformatted ? ' · raw' : ''} · click to copy`;
      div.append(text, meta);
      div.onclick = async () => { await shhh.invoke('history:copy', e.id); div.style.background = '#d4f7d4'; };
      list.appendChild(div);
    }
  }

  search.addEventListener('input', () => void refresh());
  return { refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/views/history.ts
git commit -m "feat: history view embedded in home window"
```

---

## Task 8: Settings view (views/settings.ts)

**Files:**
- Create: `renderer/views/settings.ts`

This is the largest view: Permissions + Speech-to-text + Formatting (with prompt editor) + Preferences. The Permissions/STT/Formatting logic is the same IPC dance as the current `renderer/setup.ts`; reproduce it here against the home-window IPC, and add the Preferences group and prompt editor.

- [ ] **Step 1: Write the settings view**

```ts
interface ShhhBridge {
  invoke(ch: string, ...a: unknown[]): Promise<unknown>;
  on(ch: string, fn: (...a: unknown[]) => void): void;
}
declare const shhh: ShhhBridge;

interface SttStatus {
  provider: string; model: string; configured: boolean;
  localModels: Array<{ name: string; sizeMB: number; present: boolean }>;
}
interface LlmStatus { provider: string; model: string; configured: boolean }
interface Prefs { hotkey: string; duckAudio: boolean; maxRecording: string; historyRetention: string; loginLaunch: boolean }

const CLOUD_STT_MODELS: Record<string, string> = { openai: 'whisper-1', groq: 'whisper-large-v3-turbo', deepgram: 'nova-2' };
const LLM_MODELS: Record<string, string> = { anthropic: 'claude-haiku-4-5', openai: 'gpt-4o-mini' };
const HOTKEYS = ['fn', 'rcmd', 'lcmd', 'ralt', 'lalt', 'rctrl', 'lctrl', 'rshift', 'lshift'];

function stripErr(e: unknown): string {
  return String(e instanceof Error ? e.message : e).replace(/^.*Error: /, '');
}

export function initSettingsView(): { refresh: () => Promise<void> } {
  const root = document.getElementById('view-settings')!;
  root.innerHTML = `
    <h3>Settings</h3>

    <div class="group">
      <h3>Permissions</h3>
      <div class="perm row" data-k="microphone"><span class="state">⬜</span> 🎤 Microphone <button class="action" style="margin-left:auto">Request</button></div>
      <div class="perm row" data-k="accessibility"><span class="state">⬜</span> ♿ Accessibility <button class="action" style="margin-left:auto">Open Settings</button></div>
    </div>

    <div class="group">
      <h3>Speech-to-text</h3>
      <div id="stt-summary" class="row" style="display:none"><span class="state">✅</span> <span id="stt-current"></span> <button class="action" id="stt-change" style="margin-left:auto">Change</button></div>
      <div id="stt-form">
        <div class="row"><label><input type="radio" name="sttmode" value="local" checked> Local Whisper — private, on-device</label></div>
        <div class="row" id="local-opts">
          <select id="local-model"></select>
          <button class="action" id="local-go">Download &amp; use</button>
          <progress id="local-prog" max="100" value="0" style="display:none"></progress>
        </div>
        <div class="row"><label><input type="radio" name="sttmode" value="cloud"> Cloud API — your key</label></div>
        <div class="row" id="cloud-opts" style="display:none">
          <select id="cloud-provider"><option value="openai">OpenAI</option><option value="groq">Groq</option><option value="deepgram">Deepgram</option></select>
          <input id="cloud-model" type="text"><input id="cloud-key" type="password" placeholder="API key (Keychain)">
          <button class="action" id="cloud-go">Save</button>
        </div>
      </div>
      <div id="stt-error" class="err"></div>
    </div>

    <div class="group">
      <h3>Formatting <span class="note">(optional)</span></h3>
      <div id="llm-summary" class="row" style="display:none"><span class="state">✅</span> <span id="llm-current"></span> <button class="action" id="llm-change" style="margin-left:auto">Change</button> <button class="action" id="llm-off">Disable</button></div>
      <div id="llm-form">
        <div class="note">An LLM pass that strips filler words and fixes punctuation. Skip it and shhh pastes the raw transcription.</div>
        <div class="row">
          <select id="llm-provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select>
          <input id="llm-model" type="text"><input id="llm-key" type="password" placeholder="API key (Keychain)">
          <button class="action" id="llm-go">Save</button>
        </div>
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <label class="note">System prompt</label>
        <textarea id="prompt-text"></textarea>
        <div class="row"><button class="action" id="prompt-save">Save prompt</button><button class="action" id="prompt-reset">Reset to default</button></div>
      </div>
      <div id="llm-error" class="err"></div>
    </div>

    <div class="group">
      <h3>Preferences</h3>
      <div class="row"><label class="name">Hotkey (hold)</label><select id="pref-hotkey"></select></div>
      <div class="row"><label class="name">Duck audio</label><input type="checkbox" id="pref-duck"> <span class="note">lower system volume while recording</span></div>
      <div class="row"><label class="name">Max recording</label><input type="text" id="pref-max" style="width:80px"> <span class="note">e.g. 10m</span></div>
      <div class="row"><label class="name">History retention</label><input type="text" id="pref-retention" style="width:80px"> <span class="note">e.g. 30d, or "off" to keep forever</span></div>
      <div class="row"><label class="name">Launch at login</label><input type="checkbox" id="pref-login"></div>
      <div id="pref-error" class="err"></div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;

  let busy = false, sttChange = false, llmChange = false;

  // ---- Permissions ----
  root.querySelectorAll<HTMLElement>('.perm button').forEach((btn) =>
    btn.addEventListener('click', () => void shhh.invoke('perm:request', (btn.parentElement as HTMLElement).dataset.k)));

  async function refreshPerms(): Promise<void> {
    const st = (await shhh.invoke('perm:status')) as Record<string, boolean>;
    root.querySelectorAll<HTMLElement>('.perm').forEach((el) => {
      const ok = st[el.dataset.k!];
      el.querySelector('.state')!.textContent = ok ? '✅' : '⬜';
      (el.querySelector('button') as HTMLButtonElement).style.visibility = ok ? 'hidden' : 'visible';
    });
  }

  // ---- STT ----
  root.querySelectorAll<HTMLInputElement>('input[name="sttmode"]').forEach((r) =>
    r.addEventListener('change', () => {
      $('local-opts').style.display = r.value === 'local' && r.checked ? 'flex' : 'none';
      $('cloud-opts').style.display = r.value === 'cloud' && r.checked ? 'flex' : 'none';
    }));
  $('cloud-provider').addEventListener('change', () => { $<HTMLInputElement>('cloud-model').value = CLOUD_STT_MODELS[$<HTMLSelectElement>('cloud-provider').value]; });
  $<HTMLInputElement>('cloud-model').value = CLOUD_STT_MODELS.openai;

  function syncLocalBtn(st: SttStatus): void {
    const present = st.localModels.find((m) => m.name === $<HTMLSelectElement>('local-model').value)?.present;
    $('local-go').textContent = present ? 'Use' : 'Download & use';
  }
  $('local-model').addEventListener('change', () => void (async () => syncLocalBtn((await shhh.invoke('stt:status')) as SttStatus))());
  $('local-go').addEventListener('click', () => void (async () => {
    const prog = $<HTMLProgressElement>('local-prog');
    busy = true; $('stt-error').textContent = ''; prog.style.display = 'inline-block'; prog.value = 0;
    try { await shhh.invoke('stt:useLocal', $<HTMLSelectElement>('local-model').value); sttChange = false; }
    catch (e) { $('stt-error').textContent = stripErr(e); }
    busy = false; prog.style.display = 'none'; void refreshStt();
  })());
  $('cloud-go').addEventListener('click', () => void (async () => {
    $('stt-error').textContent = '';
    try {
      await shhh.invoke('stt:useCloud', { provider: $<HTMLSelectElement>('cloud-provider').value, model: $<HTMLInputElement>('cloud-model').value, apiKey: $<HTMLInputElement>('cloud-key').value });
      $<HTMLInputElement>('cloud-key').value = ''; sttChange = false;
    } catch (e) { $('stt-error').textContent = stripErr(e); }
    void refreshStt();
  })());
  $('stt-change').addEventListener('click', () => { sttChange = true; void refreshStt(); });
  shhh.on('stt:progress', (pct) => { $<HTMLProgressElement>('local-prog').value = pct as number; });

  async function refreshStt(): Promise<void> {
    if (busy) return;
    const st = (await shhh.invoke('stt:status')) as SttStatus;
    if (st.configured && !sttChange) {
      $('stt-current').textContent = st.provider === 'local' ? `Local Whisper (${st.model})` : `${st.provider} (${st.model})`;
      $('stt-summary').style.display = 'flex'; $('stt-form').style.display = 'none';
    } else {
      $('stt-summary').style.display = 'none'; $('stt-form').style.display = 'block';
      const sel = $<HTMLSelectElement>('local-model'); const prev = sel.value; sel.replaceChildren();
      for (const m of st.localModels) {
        const opt = document.createElement('option');
        opt.value = m.name; opt.textContent = `${m.name} — ${m.present ? 'downloaded' : `${m.sizeMB} MB`}${m.name === 'base.en' ? ' (recommended)' : ''}`;
        sel.appendChild(opt);
      }
      sel.value = prev && st.localModels.some((m) => m.name === prev) ? prev : 'base.en';
      syncLocalBtn(st);
    }
  }

  // ---- LLM ----
  $('llm-provider').addEventListener('change', () => { $<HTMLInputElement>('llm-model').value = LLM_MODELS[$<HTMLSelectElement>('llm-provider').value]; });
  $<HTMLInputElement>('llm-model').value = LLM_MODELS.anthropic;
  $('llm-go').addEventListener('click', () => void (async () => {
    $('llm-error').textContent = '';
    try {
      await shhh.invoke('llm:set', { provider: $<HTMLSelectElement>('llm-provider').value, model: $<HTMLInputElement>('llm-model').value, apiKey: $<HTMLInputElement>('llm-key').value });
      $<HTMLInputElement>('llm-key').value = ''; llmChange = false;
    } catch (e) { $('llm-error').textContent = stripErr(e); }
    void refreshLlm();
  })());
  $('llm-change').addEventListener('click', () => { llmChange = true; void refreshLlm(); });
  $('llm-off').addEventListener('click', () => void (async () => { await shhh.invoke('llm:disable'); llmChange = false; void refreshLlm(); })());
  $('prompt-save').addEventListener('click', () => void shhh.invoke('prompt:set', $<HTMLTextAreaElement>('prompt-text').value));
  $('prompt-reset').addEventListener('click', () => void (async () => { const def = await shhh.invoke('prompt:reset'); $<HTMLTextAreaElement>('prompt-text').value = def as string; })());

  async function refreshLlm(): Promise<void> {
    const st = (await shhh.invoke('llm:status')) as LlmStatus;
    if (st.configured && !llmChange) {
      $('llm-current').textContent = `${st.provider} (${st.model})`;
      $('llm-summary').style.display = 'flex'; $('llm-form').style.display = 'none';
    } else {
      $('llm-summary').style.display = 'none'; $('llm-form').style.display = 'block';
    }
    $<HTMLTextAreaElement>('prompt-text').value = (await shhh.invoke('prompt:get')) as string;
  }

  // ---- Preferences ----
  const hsel = $<HTMLSelectElement>('pref-hotkey');
  for (const h of HOTKEYS) { const o = document.createElement('option'); o.value = h; o.textContent = h === 'fn' ? 'fn (🌐)' : h; hsel.appendChild(o); }
  const setPref = (key: string, value: unknown): void => void (async () => {
    $('pref-error').textContent = '';
    try { await shhh.invoke('config:set', key, value); } catch (e) { $('pref-error').textContent = stripErr(e); void refreshPrefs(); }
  })();
  hsel.addEventListener('change', () => setPref('hotkey', hsel.value));
  $<HTMLInputElement>('pref-duck').addEventListener('change', (e) => setPref('duckAudio', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('pref-login').addEventListener('change', (e) => setPref('loginLaunch', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('pref-max').addEventListener('change', (e) => setPref('maxRecording', (e.target as HTMLInputElement).value));
  $<HTMLInputElement>('pref-retention').addEventListener('change', (e) => setPref('historyRetention', (e.target as HTMLInputElement).value));

  async function refreshPrefs(): Promise<void> {
    const p = (await shhh.invoke('config:get')) as Prefs;
    hsel.value = p.hotkey;
    $<HTMLInputElement>('pref-duck').checked = p.duckAudio;
    $<HTMLInputElement>('pref-login').checked = p.loginLaunch;
    $<HTMLInputElement>('pref-max').value = p.maxRecording;
    $<HTMLInputElement>('pref-retention').value = p.historyRetention;
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshPerms(), refreshStt(), refreshLlm(), refreshPrefs()]);
  }
  // Live-poll permissions/STT while the Settings view is what users act on.
  setInterval(() => { if (!$('view-settings').classList.contains('hidden')) { void refreshPerms(); void refreshStt(); } }, 1500);
  return { refresh };
}
```

- [ ] **Step 2: Build the renderer**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: no errors (all three view modules now exist).

- [ ] **Step 3: Commit**

```bash
git add renderer/views/settings.ts
git commit -m "feat: settings view — permissions, STT, formatting + prompt, preferences"
```

---

## Task 9: Wire the home window into index.ts

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Swap imports**

In `src/main/index.ts`, replace the `HistoryWindow` import line:

```ts
import { HistoryWindow } from './history-window';
```

with:

```ts
import { initHomeWindow, showHome } from './home-window';
import { buildAppStatus } from '../core/status';
import { isModelPresent } from '../core/models';
import { KeyProvider } from '../core/api-keys';
```

- [ ] **Step 2: Replace window/tray/session wiring**

Replace the block from `const overlay = new OverlayWindow();` through the end of `app.whenReady().then(...)` (the `await rpc.listen();` line and its closing `});`) with:

```ts
  const overlay = new OverlayWindow();
  const recorder = new RecorderWindow();

  // Keep the OS login item in sync with the stored preference.
  app.setLoginItemSettings({ openAtLogin: store.getSettings().loginLaunch });

  const { wireSession } = await import('./session-controller');
  const session = await wireSession({ store, apiKeys, overlay, recorder, dataDir: dir });

  initHomeWindow({
    store, apiKeys, dataDir: dir,
    setHotkey: session.setHotkey,
    checkUpdates: () => void import('./update-flow').then((m) => m.runUpdateFlow()),
  });

  overlay.onClick(() => showHome('history'));

  try {
    tray = createTray({
      onHome: () => showHome('home'),
      onHistory: () => showHome('history'),
      onSetup: () => showHome('settings'),
      onCheckUpdates: () => void import('./update-flow').then((m) => m.runUpdateFlow()),
    });
  } catch (e) {
    console.error('tray creation failed:', e);
  }

  // Re-launching shhh (Spotlight/Finder) or activating it surfaces the window —
  // works even when the tray icon is hidden under the notch.
  app.on('second-instance', () => showHome());
  app.on('activate', () => showHome());

  // First run / incomplete config: open the window on Settings so the user can finish.
  const s = store.getSettings();
  const sttKeyPresent = s.sttProvider !== 'local' && s.sttProvider !== 'unset' ? apiKeys.get(s.sttProvider as KeyProvider) !== null : false;
  const status = buildAppStatus({
    settings: s, version: app.getVersion(), permissions: await session.checkPermissions(),
    sttModelPresent: s.sttProvider === 'local' && isModelPresent(dir, s.sttModel),
    sttKeyPresent, llmKeyPresent: false,
  });
  if (!status.ready) showHome('settings');

  const rpc = new RpcServer(socketPath(), {
    ...buildHandlers({ store, apiKeys, dataDir: dir, checkPermissions: session.checkPermissions, appVersion: app.getVersion() }),
    'setup.open': async () => { showHome('settings'); return 'ok'; },
  });
  await rpc.listen();
});
```

- [ ] **Step 3: Remove the single-instance early-quit so second-instance can fire**

The line near the top, `if (!app.requestSingleInstanceLock()) app.quit();`, stays — but it already gives the lock to the first instance and quits the second; the first instance receives `second-instance`. No change needed (the `second-instance` handler added in Step 2 does the work). Confirm the line is unchanged.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: ends with `ok ../dist/cli/index.js`, no TS errors. (If errors mention `setup-window`/`history-window`, they're removed in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire home window — reopen-to-show, first-run settings, tray, login sync"
```

---

## Task 10: Tray deep-links

**Files:**
- Modify: `src/main/tray.ts`

- [ ] **Step 1: Rewrite the tray with deep-link callbacks**

Replace the whole `createTray` function in `src/main/tray.ts` with:

```ts
export function createTray(opts: {
  onHome: () => void; onHistory: () => void; onSetup: () => void; onCheckUpdates: () => void;
}): Tray {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🤫');
  tray.setToolTip('shhh — hold fn to dictate');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open shhh', click: opts.onHome },
    { label: 'History', click: opts.onHistory },
    { label: 'Settings…', click: opts.onSetup },
    { label: 'Check for Updates…', click: opts.onCheckUpdates },
    { type: 'separator' },
    { label: 'Quit shhh', click: () => app.quit() },
  ]));
  return tray;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no TS errors (index.ts already passes `onHome`).

- [ ] **Step 3: Commit**

```bash
git add src/main/tray.ts
git commit -m "feat: tray deep-links into home window sections"
```

---

## Task 11: Delete old windows + update assets

**Files:**
- Delete: `src/main/setup-window.ts`, `src/main/history-window.ts`, `renderer/setup.html`, `renderer/setup.ts`, `renderer/history.html`, `renderer/history.ts`
- Modify: `scripts/copy-assets.mjs`

- [ ] **Step 1: Delete the obsolete files**

```bash
git rm src/main/setup-window.ts src/main/history-window.ts renderer/setup.html renderer/setup.ts renderer/history.html renderer/history.ts
```

- [ ] **Step 2: Update `scripts/copy-assets.mjs` asset list**

Replace the array in `scripts/copy-assets.mjs` with:

```js
for (const f of ['overlay.html', 'overlay.css', 'home.html', 'home.css', 'recorder.html', 'recorder-worklet.js', 'trayTemplate.png', 'trayTemplate@2x.png']) {
```

- [ ] **Step 3: Grep for any lingering references**

Run: `grep -rn "setup-window\|history-window\|setup.html\|history.html\|openSetupWindow" src/ renderer/ scripts/`
Expected: no output. (If `src/main/index.ts` still references them, fix per Task 9.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: ends with `ok ../dist/cli/index.js`, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove standalone setup/history windows (folded into home window)"
```

---

## Task 12: Full test pass + smoke checklist update

**Files:**
- Modify: `docs/manual-smoke-checklist.md`

- [ ] **Step 1: Run the full unit suite on the node ABI**

Run: `npm run rebuild:node && npx vitest run`
Expected: all tests pass (existing + new `tests/status.test.ts`). No references to deleted modules remain (the old setup/history windows had no unit tests).

- [ ] **Step 2: Restore the Electron ABI for running the app**

Run: `npm run rebuild:electron`
Expected: `Rebuild Complete`.

- [ ] **Step 3: Add smoke-checklist items**

In `docs/manual-smoke-checklist.md`, replace item 1 and item 5 and add new items:

```markdown
1. **First-run setup**: delete `~/Library/Application Support/shhh`, launch → home window opens on **Settings**; Microphone + Accessibility grant live (no restart); STT downloadable; window switches to Home once ready.
5. **Home window access**: with the app running, re-launch shhh from Spotlight → window comes to the front even if the tray icon is hidden under the notch. Tray → Open shhh / History / Settings / Check for Updates each open the right section. Closing the window keeps dictation working; Quit (Home or tray) exits.
15. **Live hotkey change**: Settings → Preferences → change Hotkey → hold the new key → dictation triggers without restarting the app.
16. **Preferences persistence**: toggle Duck audio and Launch at login; reopen the window → values stuck; reboot → app auto-launches if Launch at login was on.
```

- [ ] **Step 4: Manually verify the app**

Run: `npx electron .`
Expected: home window opens (Settings if not configured, else stays background). Navigate all three sections; change a preference; close + reopen via Spotlight.

- [ ] **Step 5: Commit**

```bash
git add docs/manual-smoke-checklist.md
git commit -m "docs: smoke checklist for home window access + live settings"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** sidebar/3 views (T5-8), second-instance/activate (T9), close-hides + quit (T3), tray deep-links (T10), comprehensive Settings incl. prompt + preferences (T8), `setHotkey` live rebind (T2/T8), launch-at-login wiring (T3 handler + T9 startup sync), `app:status` dashboard (T1/T6), delete old windows (T11), CLI `setup.open` → home (T9). All covered.
- **Type consistency:** `showHome(section?: Section)`, `initHomeWindow(HomeDeps)`, `wireSession → { checkPermissions, setHotkey }`, view modules export `init*View(): { refresh }`, `nav` event carries a `Section` string — consistent across tasks.
- **No placeholders:** every code step is complete; migrated renderer logic is reproduced in full (not referenced).
