# shhh — Home Window (consolidated UI) design

**Date:** 2026-06-23
**Status:** Approved (pending spec review)

## Problem

shhh is a menu-bar background app whose only persistent entry point is the 🤫 tray icon. On notched MacBooks macOS hides overcrowded menu-bar items under the notch, so the tray icon becomes unreachable and there is no other way to open History or Settings. Separately, configuration is split between a first-run setup wizard window, a history window, and a CLI — there is no single place to see status or change settings.

This design introduces a single **home window**: a consolidated UI that is the app's default screen, reachable independently of the tray, and the primary surface for status, history, and all settings. The CLI remains fully functional but is no longer the primary configuration surface — the project is moving UI-first.

## Goals

- One window with sidebar navigation: **Home / History / Settings**.
- Reachable without the tray: re-launching shhh from Spotlight/Finder brings the window to the front.
- Settings exposes **everything the config CLI does**, so users never need the terminal for day-to-day use.
- Background-app behavior preserved: closing the window keeps dictation running; no Dock icon.

## Non-goals

- No Dock icon / Cmd-Tab presence (stays `LSUIElement`).
- No cloud sync, no account, no new dictation features.
- The CLI is not removed or deprecated; it keeps working against the same store.

## Architecture

A single `BrowserWindow` rendered by `renderer/home.html` + `renderer/home.ts`, with a left sidebar and a content pane that swaps between three views client-side (no per-view windows). It replaces the separate setup and history windows as user-facing chrome. The `overlay` (listening indicator) and hidden `recorder` windows are unchanged.

### Components

- **`src/main/home-window.ts`** (new) — owns the single home `BrowserWindow`: create, show, focus, hide, and a `show(section?)` method that brings the window forward and navigates to a given section (`'home' | 'history' | 'settings'`) via an IPC send. Single responsibility: window lifecycle + section routing. Registers all renderer IPC handlers (moved here from the deleted setup/history windows so registration lives in one place).
- **`renderer/home.html` / `home.ts`** (new) — sidebar + three views. `home.ts` composes the existing view logic; the current `setup.ts` and `history.ts` behavior is folded into Settings and History views respectively.
- **Deleted:** `src/main/setup-window.ts`, `src/main/history-window.ts`, `renderer/setup.html`, `renderer/setup.ts`, `renderer/history.html`, `renderer/history.ts` (their logic migrates into the home window/renderer).
- **`src/main/session-controller.ts`** (modified) — `wireSession` returns (in addition to today's `checkPermissions`) a `setHotkey(hotkey: string)` that stops the current `KeyListener`, resolves the new code (with the existing fallback), and starts a fresh listener — so a hotkey change in the UI applies without restart.
- **`src/main/index.ts`** (modified) — `second-instance` handler (re-launch while running) and `activate` handler both call `homeWindow.show()`; tray wired to `homeWindow.show(section)`; window `close` hides instead of quitting.

### The three views

1. **Home** — status dashboard:
   - ● Running indicator, app version.
   - Hotkey (current), STT summary (provider/model), Formatting (on/off + provider).
   - Buttons: **Check for Updates…**, **Quit shhh**.
   - If Microphone/Accessibility or STT is not configured, a banner links to Settings.
2. **History** — the existing list with search box and click-to-copy, embedded unchanged in behavior.
3. **Settings** — comprehensive, four groups:
   - **Permissions** — Microphone, Accessibility (live status, request buttons). Live-detected; no restart.
   - **Speech-to-text** — local Whisper (model picker + in-window download with progress + checksum) or cloud provider (OpenAI/Groq/Deepgram) + API key. Summary + Change once configured.
   - **Formatting** — provider (Anthropic/OpenAI), model, API key, enable/disable; **system-prompt editor** (multi-line) with **Reset to default**.
   - **Preferences** — hotkey picker (fn / left+right of ⌘ ⌥ ⌃ ⇧), duck-audio toggle, max-recording duration, history-retention (off or duration), launch-at-login toggle.

### IPC (preload allowlist)

Reuses existing handlers: `perm:status`, `perm:request`, `stt:status`, `stt:useLocal`, `stt:useCloud` (+ `stt:progress` event), `llm:status`, `llm:set`, `llm:disable`, `history:list`, `history:copy`.

Adds:
- `app:status` → `{ running: true, version, hotkey, stt: {provider, model, configured}, llm: {provider, model, configured}, permissions }` for the Home dashboard.
- `app:quit` → quits the app.
- `app:checkUpdates` → runs the existing update flow.
- `nav` (main→renderer event) → tells the renderer which section to show.
- `config:get` / `config:set` for `hotkey`, `duck-audio`, `max-recording`, `history-retention`, `login-launch` — delegating to the same store/settings the CLI uses. `config:set('hotkey', …)` additionally calls `session.setHotkey(...)`. `config:set('login-launch', …)` additionally calls `app.setLoginItemSettings(...)`.
- `prompt:get` / `prompt:set` / `prompt:reset` for the system-prompt editor.

## Data flow

- Renderer polls `app:status`, `perm:status`, `stt:status`, `llm:status` on an interval while visible (as setup.ts does today) so live permission/STT changes reflect without manual refresh.
- All writes go through IPC → main → `ShhhStore` (the same store the CLI mutates), so CLI and UI never diverge.
- Live-apply: `duckAudio` and `maxRecordingMs` are already read per-dictation via `getSettings()`, so they apply instantly. `hotkey` applies via `session.setHotkey()`. `loginLaunch` applies via `app.setLoginItemSettings()`.

## Access & lifecycle (the notch fix)

- **`second-instance`**: re-launching shhh (Spotlight/Finder/`open`) shows + focuses the home window. Today the second instance silently quits; the lock holder will now surface the window instead.
- **Tray** (deep-links): **Open shhh** → Home; **History** → History; **Settings…** → Settings; **Check for Updates…**; ─; **Quit shhh**. Each navigates the window to the section.
- **Close = hide** (`win.on('close')` → `preventDefault` + `win.hide()`), dictation keeps running. **Quit** (Home button or tray) fully exits.
- Stays `LSUIElement` (no Dock icon).
- First run / incomplete config: home window auto-opens on **Settings**. Once permissions + STT are ready it opens on **Home**. The `shhh setup` CLI command and `setup.open` RPC now open the home window on Settings.

## Error handling

- Each Settings action surfaces its own inline error (existing pattern in setup.ts: strip the Electron IPC error prefix, show message only). A failed model download, bad API key, or invalid hotkey shows next to the control; never silent.
- Tray creation already fails soft (a missing icon must not take down hotkey/RPC). The home window create is likewise wrapped so a window failure can't break dictation.

## Testing

- **Unit:** pure-logic only — the `app:status` summary builder (settings → dashboard shape) and any section-routing/validation helpers. Keep them in `src/core` or a pure module so they test under the node ABI.
- **Manual (smoke checklist):** add items — (a) reopen from Spotlight shows the window even with the tray hidden; (b) each tray deep-link lands on the right section; (c) changing the hotkey in Preferences applies without restart; (d) close hides + dictation still works, Quit exits; (e) launch-at-login toggle persists across reboot.
- No native-module or e2e additions.

## Migration / scope notes

- Removing the separate setup/history windows is a clean replacement, not a parallel path — avoids two code paths for the same config.
- CLI-only settings (hotkey, duck-audio, max-recording, retention, login-launch, system prompt) all gain UI; the CLI keeps working against the same store.
- `deviceId` remains internal (not shown).
