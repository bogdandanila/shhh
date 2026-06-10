# shhh — Local-First Voice Dictation for macOS

**Date:** 2026-06-10
**Status:** Approved design, pre-implementation

## Overview

`shhh` is a privacy-first voice dictation app for macOS, in the spirit of Superwhisper and Wispr Flow: hold a key, speak, release — clean formatted text is pasted into whatever input you were focused on. All data stays on the user's machine, all API keys belong to the user, and the formatting prompt is fully user-controllable.

Built entirely in **TypeScript** on **Electron**, with a companion **CLI** for all configuration. The app has minimal UI: a small always-on-top overlay indicator, a history panel, and a one-time permission setup window.

## Goals

- Hold-to-talk dictation (fn key by default, configurable) that pastes into the focused input of any app.
- Two-pass pipeline: speech-to-text, then LLM formatting (filler removal, dedup, punctuation, sentence structure).
- Local-first and private: encrypted local storage, no telemetry, no training on user data, works fully offline with a local whisper model.
- User-owned API keys and models, configured via CLI. All provider defaults are **empty/unset**.
- Long dictation support (default 10-minute safety cap, configurable).
- Installable from the command line via npm, without an Apple Developer account.

## Non-Goals (v1)

- Cloud sync / hosted DB / web UI — explicitly out of scope, but the schema and crypto design are forward-compatible with a zero-knowledge sync service (see Future: Cloud Sync).
- User accounts / sign-in — not needed while everything is local.
- Windows/Linux support.
- Streaming live transcription while speaking (text appears after release, all at once).
- Mac App Store or notarized distribution (deferred until/if commercial).

## Architecture

```
┌────────────────────────── Electron main process ──────────────────────────┐
│                                                                           │
│  KeyListener (uiohook-napi) ── fn down/up (flagsChanged) events           │
│       │                                                                   │
│       ▼                                                                   │
│  SessionController ──── orchestrates one dictation cycle                  │
│       │                                                                   │
│       ├─► OverlayWindow   hidden → listening → processing → done/error    │
│       ├─► Recorder        hidden renderer, getUserMedia → WAV 16kHz mono  │
│       ├─► Transcriber     pass 1 (pluggable: LocalWhisper | CloudSTT)     │
│       ├─► Formatter       pass 2 (pluggable: Anthropic | OpenAI | none)   │
│       ├─► Paster          clipboard swap + synthetic ⌘V + restore         │
│       └─► HistoryStore    encrypted SQLite (SQLCipher), local only        │
│                                                                           │
│  PermissionsManager ── TCC detection, setup window, deep links            │
│  SocketServer ──────── JSON-RPC over unix socket for the CLI             │
└───────────────────────────────────────────────────────────────────────────┘
        ▲
        │ unix domain socket (~/Library/Application Support/shhh/shhh.sock)
   shhh CLI  (config, keys, models, prompt, history, daemon control)
```

### Dictation cycle (happy path)

1. User holds fn → KeyListener fires → SessionController starts Recorder; OverlayWindow shows "listening" with mic level and elapsed time.
2. User releases fn → recording stops (recordings < ~300ms discarded as accidental taps); overlay switches to "processing" spinner.
3. WAV buffer → Transcriber → raw text.
4. Raw text → Formatter → formatted text. If no formatter configured, raw text is used as-is.
5. Paster injects text into the focused app; overlay flashes success and hides.
6. Entry saved to encrypted history. Audio buffer zeroed — never written to disk.

Clicking the overlay (or tray icon) opens the HistoryPanel: recent formatted messages, search box, click-to-copy.

## Components

### KeyListener

- `uiohook-napi` global hook in the main process. fn surfaces as a `flagsChanged` modifier event; we track down/up transitions for hold-to-talk.
- Hotkey configurable via `shhh config set hotkey <key>`; default `fn`.
- Requires Input Monitoring permission.

### Recorder

- Hidden renderer window holds a lazily created, kept-warm `getUserMedia` context so recording starts in <50ms.
- Captures 16kHz mono PCM via AudioWorklet; hands WAV buffer to main process on stop.
- Requires Microphone permission.
- **Recording length:** default safety cap 10 minutes, configurable (`shhh config set max-recording 30m`). Hitting the cap stops gracefully and processes captured audio — never discards. Overlay pulses a warning in the final 30 seconds. Memory footprint is ~1.9MB/minute (non-issue).

### Transcriber (pass 1)

```ts
interface Transcriber {
  transcribe(wav: Buffer): Promise<string>;
}
```

- **LocalWhisper:** whisper.cpp via `smart-whisper` Node bindings (Metal-accelerated on Apple Silicon). Models downloaded on demand (`shhh model download base.en`) to `~/Library/Application Support/shhh/models/`, HTTPS from Hugging Face, checksum-verified. Never bundled. No inherent recording-length limit (whisper.cpp chunks internally).
- **CloudSTT:** one provider class each for OpenAI (`whisper-1` / `gpt-4o-transcribe`), Groq (`whisper-large-v3`), Deepgram. User's API key, TLS only. Before upload, WAV is encoded to a compressed format (~10x smaller, raising provider size ceilings from ~13 min to hours). If still over the provider limit, audio is chunked on silence boundaries and transcripts stitched.
- **Default: unset.** First run instructs the user to download a local model or set a cloud key.
- STT processing timeout: 30s per request/chunk (processing wait, not a recording cap).

### Formatter (pass 2)

```ts
interface Formatter {
  format(raw: string): Promise<string>;
}
```

- Providers: **Anthropic** (official SDK; suggested model `claude-haiku-4-5` — fast/cheap; model string user-choosable) and **OpenAI**. Default: **unset** — with no formatter, raw transcription is pasted (app is useful with zero LLM config).
- Default system prompt ships with the app: remove filler words ("um", "uh"), remove duplicated words, fix punctuation and sentence structure, preserve meaning, output only the cleaned text. Fully replaceable via `shhh prompt set` / `shhh prompt edit`; `shhh prompt reset` restores the default.
- One retry on transient failure, then fall back to raw text (entry marked `unformatted`).
- Sanity check on LLM output: if empty or wildly longer/shorter than input, fall back to raw.
- Formatting timeout scales with input length (baseline 15s for short dictations).

### Paster

- Save current clipboard → write text to clipboard → synthesize ⌘V (CGEvent via small native call or AppleScript) → restore previous clipboard after ~300ms.
- Requires Accessibility permission.
- If paste fails (no permission, secure input field): text stays on the clipboard and the overlay says "Copied — press ⌘V".

### OverlayWindow

- Small frameless, transparent, non-activating Electron panel near bottom-center of the active screen.
- `alwaysOnTop: 'screen-saver'`, visible on all workspaces including over fullscreen apps. Never steals focus.
- States: hidden → listening (mic level + elapsed time) → processing (spinner) → done/error flash.
- Click → HistoryPanel.

### HistoryPanel

- Compact window: recent formatted messages, search, click-to-copy. Backed by HistoryStore.

### PermissionsManager + setup window

macOS TCC permissions attach to the app bundle, so the Electron app owns the permission ceremony:

| Permission | Grant mechanism |
|---|---|
| Microphone | Native system prompt on first `getUserMedia` |
| Input Monitoring | App triggers registration (`IOHIDRequestAccess`), deep-links to `x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent`, polls until granted |
| Accessibility | `AXIsProcessTrustedWithOptions(prompt: true)` dialog + deep link, polls until granted |

- First launch with missing permissions → setup window with a live 3-item checklist (the one deliberate UI moment).
- Input Monitoring takes effect after relaunch → setup window offers one-click "Restart shhh".
- `shhh doctor` re-checks all three any time and reopens the setup window if revoked.
- **Ad-hoc signing caveat:** without a Developer ID, each update changes the code signature and resets Input Monitoring + Accessibility grants. `shhh update` knows this and automatically re-opens the setup window after updating.

## Security & Storage

### Database

- Single SQLite file: `~/Library/Application Support/shhh/shhh.db`, encrypted at rest with **SQLCipher** (`better-sqlite3-multiple-ciphers`, AES-256 full-database).
- Tables:
  - `history` — id (UUIDv7), raw text, formatted text, created_at, updated_at, deleted_at (tombstone), device_id, provider/model used, duration, `unformatted` flag.
  - `settings` — non-secret config (providers, models, hotkey, system prompt, caps).
- **Sync-ready schema from day one:** UUIDv7 primary keys (no autoincrement), created_at/updated_at/deleted_at, device_id.

### Key management

1. First run: generate random 256-bit DB key.
2. Encrypt it with Electron `safeStorage` (macOS Keychain-backed, tied to app code signature). Plaintext key exists only in app memory; encrypted blob on disk next to the DB.
3. Stolen DB file → unreadable. Other apps on the same Mac → cannot decrypt.

### API keys

- Each provider key stored as its **own macOS Keychain item** — never in SQLite, never in config files, never in logs.
- `shhh config get` shows redacted tails only (`sk-ant-…7f2k`).
- Keys entered via hidden interactive prompt — never as command arguments (shell history leak).

### Network posture

- Only network traffic: TLS 1.2+ calls to user-configured STT/LLM providers, and checksum-verified whisper model downloads.
- No telemetry, no analytics, no auto-update phone-home. With local whisper + no formatter: fully offline, zero network calls.
- Audio: memory-only between release and transcription, then zeroed. Never on disk.

### CLI ↔ app boundary

- CLI never touches Keychain or DB directly. JSON-RPC over unix domain socket (`shhh.sock`, mode 600, peer-uid checked). Secrets handling lives in exactly one process.

### Housekeeping

- `shhh history clear`; optional retention (`shhh config set history-retention 30d`); `shhh nuke` wipes DB + Keychain items.

## Future: Cloud Sync (out of scope v1, designed-for)

- Target model: **zero-knowledge / E2E encryption** (Bitwarden-style). The existing random DB key gets additionally wrapped by a passphrase-derived key (Argon2id); only ciphertext ever reaches the server. Web UI would decrypt client-side after passphrase entry. Supports portability to a new machine, including provider keys.
- Server-readable storage is explicitly rejected — it would contradict the app's privacy positioning.
- Auth (e.g. Google sign-in) would live on the future web/sync service, not the local app.
- Today's design requires no changes when sync arrives: schema is sync-ready, crypto wraps forward.

## CLI

```
shhh setup                      # launch app, run permission onboarding
shhh doctor                     # check permissions, model presence, key validity
shhh status                     # daemon running, active providers

shhh config set stt.provider local|openai|groq|deepgram
shhh config set stt.model base.en
shhh config set llm.provider anthropic|openai|none
shhh config set llm.model claude-haiku-4-5
shhh config set <provider>.api-key         # hidden interactive prompt
shhh config set hotkey fn
shhh config set max-recording 10m
shhh config set history-retention 30d
shhh config set login-launch on|off
shhh config get [key]                      # secrets redacted

shhh model download <name>                 # whisper model management
shhh model list

shhh prompt show | set | reset             # formatting system prompt

shhh history list [-n 20] [--search foo]
shhh history copy <id>
shhh history clear
shhh nuke

shhh install                               # download+verify app into /Applications
shhh update                                # update app, re-run permission setup
shhh start | stop | restart
```

- Config precedence: defaults < settings table < per-invocation flags.
- If the app isn't running, the CLI offers to start it.

## Distribution

**Primary: npm, unsigned (no Apple Developer account).**

- `npm install -g shhh-cli` installs the CLI; `shhh install` downloads the unsigned `.app` zip from GitHub Releases via Node (no browser → **no quarantine flag → Gatekeeper never engages**), verifies SHA-256, places it in `/Applications`.
- Trade-off accepted: ad-hoc signature changes per build → Input Monitoring/Accessibility reset per update, mitigated by `shhh update` auto-reopening the setup window (~30s of toggles).
- Works identically for workspace colleagues.

**Deferred: Homebrew cask + Developer ID signing/notarization** — purely additive if the project goes commercial. CI (GitHub Actions) + electron-builder already produce the universal (arm64+x64) artifact either way.

- CLI binary ships inside the app bundle (`shhh.app/Contents/Resources/bin/shhh`); npm package is a thin bootstrapper so CLI and app versions can't drift.
- Launch at login: off by default, via `app.setLoginItemSettings` (SMAppService).

## Error Handling

Principle: **never lose the user's words.**

| Failure | Behavior |
|---|---|
| STT fails (no model, bad key, network) | Overlay error + reason; nothing pasted; `shhh doctor` hint logged |
| Formatter fails | One retry → paste **raw** transcription, mark entry `unformatted` |
| Paste fails (no Accessibility, secure input) | Text stays on clipboard; overlay: "Copied — press ⌘V" |
| Mic permission revoked | Overlay error; setup window reopens on next attempt |
| App crash during recording | Audio was memory-only; clean state on relaunch; SQLite transactions prevent partial writes |
| LLM output garbage (empty/refusal/wild length) | Fall back to raw |
| Recording cap reached | Stop gracefully, process captured audio, never discard |

Timeouts: 30s STT (per request/chunk), formatting baseline 15s scaling with input length. Better raw-and-fast than perfect-and-late.

## Testing

- **Unit (vitest):** formatter prompt construction + fallbacks, config precedence, history CRUD + encryption round-trip, transcriber selection — interfaces with fakes.
- **Integration:** SQLCipher round-trip (create/encrypt/reopen/wrong-key-fails); CLI↔daemon socket protocol against a stub; WAV fixture through whisper.cpp tiny model with keyword assertions (CI-friendly).
- **Manual smoke checklist** (in repo, run per release candidate): TCC permission flows, fn capture, paste into real apps (browser, terminal, native), overlay over fullscreen apps.

## Tech Stack Summary

| Concern | Choice |
|---|---|
| Runtime/UI | Electron (TypeScript everywhere), universal arm64+x64 |
| Global key hook | uiohook-napi |
| Audio capture | getUserMedia + AudioWorklet (hidden renderer) |
| Local STT | whisper.cpp via smart-whisper |
| Cloud STT | OpenAI / Groq / Deepgram (user keys) |
| Formatting LLM | Anthropic SDK (suggested `claude-haiku-4-5`) / OpenAI (user keys) |
| Storage | SQLite + SQLCipher (`better-sqlite3-multiple-ciphers`) |
| Secrets | macOS Keychain via Electron safeStorage + per-key Keychain items |
| CLI↔app | JSON-RPC over unix domain socket |
| Tests | vitest |
| Packaging | electron-builder; npm bootstrapper + GitHub Releases |
