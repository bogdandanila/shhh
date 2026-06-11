# Audio Ducking While Recording — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

Dictating while music or any other audio is playing has two costs:

1. The playback is distracting and competes with the user's voice in the room.
2. The microphone picks it up, which degrades Whisper transcription quality and
   increases hallucinations (background music is a known trigger for phantom
   phrases like "Thank you.").

## Goal

While the dictation hotkey (fn by default) is held, lower the system output
volume; restore it as soon as the recording ends. On by default, can be turned
off via config.

## Non-Goals

- Pausing media players (Music/Spotify AppleScript control). Ducking the
  system volume covers all sound sources uniformly.
- Per-app ducking via CoreAudio process taps (macOS 14.4+ only, native code).
- Fixing Whisper's trailing-silence hallucinations ("Thank you.") — separate
  effort; ducking only reduces the music-induced subset.
- Crash-resilient volume restore (no watchdog/daemon). If the app dies
  mid-recording the volume stays ducked; accepted for v1.

## Approach

Shell out to `osascript` from the main process, matching the existing pattern
in `src/main/paster.ts`. Volume control via AppleScript's StandardAdditions
(`get volume settings` / `set volume output volume N`) is not TCC-gated, so no
new permissions are required. A native CoreAudio binding was rejected: it adds
dual-ABI rebuild complexity (keymon/smart-whisper already make rebuilds
delicate) to save ~100ms on an operation that runs twice per recording.

## Components

### `src/main/audio-ducker.ts` — `AudioDucker`

Small class owning duck/restore state. The exec function is injected
(constructor parameter defaulting to a promisified `execFile`) so tests never
touch real volume.

- `duck(): Promise<void>`
  - Runs `osascript -e 'get volume settings'`, parses `output volume:N` and
    `output muted:true|false` from the reply.
  - No-op when: already ducked (re-entrancy guard — a second `duck()` must not
    overwrite the remembered level with the ducked one), output is muted, or
    current volume ≤ duck level.
  - Otherwise remembers the current level and runs
    `osascript -e 'set volume output volume 20'`.
- `restore(): Promise<void>`
  - No-op when nothing is remembered.
  - Otherwise sets volume back to the remembered level and clears it.
- Duck level: constant `20` (0–100 scale). Not configurable in v1.
- All osascript failures are caught and logged — audio ducking must never
  break or delay a dictation cycle.

### Wiring — `src/main/session-controller.ts`

- `onDown`: when `settings.duckAudio` is true, fire-and-forget
  `void ducker.duck()` so recording start is not delayed by the ~100ms
  osascript round-trip.
- `onUp`: `restore()` runs on **every** exit path — the accidental-tap discard
  path (`elapsed < MIN_RECORDING_MS`), and the main path's `finally`. Restore
  happens at fn-release, not after transcription, so playback resumes while
  Whisper processes. The max-recording cap already funnels through `onUp`, so
  it is covered.
- Restore is fire-and-forget too; failures surface only in the log.

### Setting

- `duckAudio: boolean` added to `Settings` (`src/shared/types.ts`) and
  `DEFAULT_SETTINGS` (`src/core/settings.ts`) with default `true`.
- CLI key `duck-audio` with `on`/`off` values, following the `login-launch`
  convention in `src/core/rpc-handlers.ts` (setter map + `configView`).

## Edge Cases

| Case | Behavior |
|---|---|
| User changes volume mid-recording | Restore overwrites it (accepted; recordings last seconds) |
| App crashes mid-recording | Volume stays ducked (accepted, see Non-Goals) |
| Output muted when fn pressed | No duck, no restore |
| Volume already ≤ 20 | No duck, no restore |
| Rapid taps / duck while ducked | Re-entrancy guard keeps the original remembered level |
| osascript fails or hangs | Caught and logged; dictation proceeds at full volume |

## Testing

- `tests/audio-ducker.test.ts` with a fake exec:
  - duck stores previous level, sets 20; restore puts it back and clears state
  - muted → no-op; volume ≤ 20 → no-op
  - double duck keeps original level; restore without duck → no-op
  - exec failure does not throw out of `duck()`/`restore()`
  - parses real `get volume settings` reply shape
    (`output volume:64, input volume:90, alert volume:100, output muted:false`)
- `tests/settings.test.ts`: `duckAudio` default true.
- `tests/rpc-handlers.test.ts`: `config.set`/`config.get` round-trip for
  `duck-audio` (`on`/`off`).
- Session-controller wiring verified via the manual smoke checklist (play
  music, hold fn → volume drops; release → volume returns; quick tap →
  volume returns).
