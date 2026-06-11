# Audio Ducking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower the macOS system output volume while the dictation hotkey is held, restoring it on release, so playing music/audio doesn't pollute recordings.

**Architecture:** A new `AudioDucker` class shells out to `osascript` (same pattern as `src/main/paster.ts`) to read and set the system output volume. `session-controller.ts` calls `duck()` on hotkey-down and `restore()` on every hotkey-up exit path. A `duckAudio` setting (default on) gates the behavior, exposed as CLI key `duck-audio` with `on`/`off` values like the existing `login-launch`. Operations are serialized through an internal promise chain so a quick tap (restore racing an in-flight duck) can't strand the volume low.

**Tech Stack:** TypeScript, Electron main process, `osascript` via `node:child_process.execFile`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-audio-ducking-design.md`

---

### Task 1: `AudioDucker` class

**Files:**
- Create: `src/main/audio-ducker.ts`
- Test: `tests/audio-ducker.test.ts`

The class never throws (a failed duck must never break dictation) and serializes `duck()`/`restore()` through a promise chain. Serialization matters: `onDown` fires `duck()` and a quick tap fires `restore()` ~300ms later — if the duck's osascript round-trip is still in flight, an unserialized `restore()` would see "nothing to restore", no-op, and the duck would then land and stay forever.

- [ ] **Step 1: Write the failing tests**

Create `tests/audio-ducker.test.ts`:

```typescript
import { expect, test, vi } from 'vitest';
import { AudioDucker, parseVolumeSettings } from '../src/main/audio-ducker';

const SETTINGS_REPLY = 'output volume:64, input volume:90, alert volume:100, output muted:false';

function fakeExec(settingsReply: string = SETTINGS_REPLY) {
  const calls: string[] = [];
  const exec = vi.fn(async (script: string): Promise<string> => {
    calls.push(script);
    return script === 'get volume settings' ? settingsReply : '';
  });
  return { exec, calls };
}

test('parseVolumeSettings parses the osascript reply shape', () => {
  expect(parseVolumeSettings(SETTINGS_REPLY)).toEqual({ volume: 64, muted: false });
  expect(parseVolumeSettings('output volume:7, input volume:0, alert volume:9, output muted:true'))
    .toEqual({ volume: 7, muted: true });
  expect(parseVolumeSettings('garbage')).toBeNull();
});

test('duck lowers volume to 20, restore puts it back and clears state', async () => {
  const { exec, calls } = fakeExec();
  const d = new AudioDucker(exec);
  await d.duck();
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20']);
  await d.restore();
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20', 'set volume output volume 64']);
  await d.restore(); // second restore is a no-op
  expect(calls).toHaveLength(3);
});

test('muted output -> duck is a no-op', async () => {
  const { exec, calls } = fakeExec('output volume:64, input volume:90, alert volume:100, output muted:true');
  const d = new AudioDucker(exec);
  await d.duck();
  await d.restore();
  expect(calls).toEqual(['get volume settings']); // read but never set
});

test('volume already at or below 20 -> duck is a no-op', async () => {
  const { exec, calls } = fakeExec('output volume:15, input volume:90, alert volume:100, output muted:false');
  const d = new AudioDucker(exec);
  await d.duck();
  await d.restore();
  expect(calls).toEqual(['get volume settings']);
});

test('double duck keeps the original level', async () => {
  const { exec, calls } = fakeExec();
  const d = new AudioDucker(exec);
  await d.duck();
  await d.duck(); // re-entrant: must not re-read (would remember 20)
  await d.restore();
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20', 'set volume output volume 64']);
});

test('exec failure never throws out of duck or restore', async () => {
  const exec = vi.fn(async (): Promise<string> => { throw new Error('osascript missing'); });
  const d = new AudioDucker(exec);
  await expect(d.duck()).resolves.toBeUndefined();
  await expect(d.restore()).resolves.toBeUndefined();
});

test('quick tap: restore queued behind an in-flight duck still restores', async () => {
  let release!: (v: string) => void;
  const gate = new Promise<string>((r) => { release = r; });
  const calls: string[] = [];
  const exec = vi.fn(async (script: string): Promise<string> => {
    calls.push(script);
    return script === 'get volume settings' ? gate : '';
  });
  const d = new AudioDucker(exec);
  const duckP = d.duck();
  const restoreP = d.restore(); // fn released before osascript replied
  release(SETTINGS_REPLY);
  await Promise.all([duckP, restoreP]);
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20', 'set volume output volume 64']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/audio-ducker.test.ts`
Expected: FAIL — `Cannot find module '../src/main/audio-ducker'`

- [ ] **Step 3: Implement `AudioDucker`**

Create `src/main/audio-ducker.ts`:

```typescript
import { execFile } from 'node:child_process';

export type OsaExec = (script: string) => Promise<string>;

const DUCK_LEVEL = 20;

function defaultOsaExec(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Parses `get volume settings` output, e.g. "output volume:64, input volume:90, alert volume:100, output muted:false". */
export function parseVolumeSettings(reply: string): { volume: number; muted: boolean } | null {
  const vol = /output volume:(\d+)/.exec(reply);
  const muted = /output muted:(true|false)/.exec(reply);
  if (!vol || !muted) return null;
  return { volume: Number(vol[1]), muted: muted[1] === 'true' };
}

/**
 * Lowers the system output volume while a recording is in flight.
 * duck/restore are serialized through a promise chain — a restore issued while
 * a duck is still talking to osascript runs after it, so a quick hotkey tap
 * can't strand the volume low. Failures are logged, never thrown: ducking
 * must never break or delay a dictation cycle.
 */
export class AudioDucker {
  private previousVolume: number | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private exec: OsaExec = defaultOsaExec) {}

  duck(): Promise<void> {
    this.chain = this.chain.then(() => this.doDuck());
    return this.chain;
  }

  restore(): Promise<void> {
    this.chain = this.chain.then(() => this.doRestore());
    return this.chain;
  }

  private async doDuck(): Promise<void> {
    if (this.previousVolume !== null) return; // already ducked
    try {
      const parsed = parseVolumeSettings(await this.exec('get volume settings'));
      if (!parsed || parsed.muted || parsed.volume <= DUCK_LEVEL) return;
      this.previousVolume = parsed.volume;
      await this.exec(`set volume output volume ${DUCK_LEVEL}`);
    } catch (e) {
      this.previousVolume = null;
      console.warn('audio duck failed:', e instanceof Error ? e.message : e);
    }
  }

  private async doRestore(): Promise<void> {
    if (this.previousVolume === null) return;
    const prev = this.previousVolume;
    this.previousVolume = null;
    try {
      await this.exec(`set volume output volume ${prev}`);
    } catch (e) {
      console.warn('audio restore failed:', e instanceof Error ? e.message : e);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/audio-ducker.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/audio-ducker.ts tests/audio-ducker.test.ts
git commit -m "feat: AudioDucker — duck/restore system volume via osascript"
```

---

### Task 2: `duckAudio` setting

**Files:**
- Modify: `src/shared/types.ts:4-15` (Settings interface)
- Modify: `src/core/settings.ts:25-36` (DEFAULT_SETTINGS)
- Modify: `src/core/rpc-handlers.ts:25-59` (setters + configView) and `:103-111` (nuke reset)
- Test: `tests/settings.test.ts`, `tests/rpc-handlers.test.ts`

`ShhhStore.getSettings()` falls back to `DEFAULT_SETTINGS` per key, so existing databases pick up `duckAudio: true` with no migration.

- [ ] **Step 1: Write the failing tests**

In `tests/settings.test.ts`, inside the existing `describe('defaults', ...)` block, extend the assertions of the `'providers default to unset/none per spec'` test by adding:

```typescript
    expect(DEFAULT_SETTINGS.duckAudio).toBe(true);
```

In `tests/rpc-handlers.test.ts`, append:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings.test.ts tests/rpc-handlers.test.ts`
Expected: FAIL — `duckAudio` undefined / `Unknown config key: duck-audio`

- [ ] **Step 3: Add the setting**

In `src/shared/types.ts`, add to the `Settings` interface after `loginLaunch: boolean;`:

```typescript
  duckAudio: boolean;          // lower system volume while recording
```

In `src/core/settings.ts`, add to `DEFAULT_SETTINGS` after `loginLaunch: false,`:

```typescript
  duckAudio: true,
```

In `src/core/rpc-handlers.ts`, add to the `setters` map after the `'login-launch'` entry:

```typescript
    'duck-audio': (v) => store.patchSettings({ duckAudio: v === 'on' }),
```

In the same file, add to `configView`'s `out` object after the `'login-launch'` entry:

```typescript
      'duck-audio': s.duckAudio ? 'on' : 'off',
```

And in the `nuke` handler, extend the `store.patchSettings({...})` object with:

```typescript
        duckAudio: true,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts tests/rpc-handlers.test.ts`
Expected: PASS (all tests in both files)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/core/settings.ts src/core/rpc-handlers.ts tests/settings.test.ts tests/rpc-handlers.test.ts
git commit -m "feat: duckAudio setting, CLI key duck-audio (on by default)"
```

---

### Task 3: Wire ducking into the session controller

**Files:**
- Modify: `src/main/session-controller.ts:22-73`
- Modify: `docs/manual-smoke-checklist.md`

No unit test: `wireSession` imports Electron (`clipboard`, `systemPreferences`) and is exercised via the manual smoke checklist, per the spec. Correctness of the duck/restore state machine is covered by Task 1's tests.

- [ ] **Step 1: Wire `AudioDucker` into `wireSession`**

In `src/main/session-controller.ts`, add the import after the existing `./key-listener` import:

```typescript
import { AudioDucker } from './audio-ducker';
```

At the top of `wireSession`, alongside the other state declarations (`let busy = false;`), add:

```typescript
  const ducker = new AudioDucker();
```

Replace `onDown` with (changes: read full settings once, fire `duck()` before starting the recorder):

```typescript
  const onDown = (): void => {
    if (busy) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const settings = w.store.getSettings();
    if (settings.duckAudio) void ducker.duck();
    const max = settings.maxRecordingMs;
    recordingStart = Date.now();
    w.recorder.start();
    ticker = setInterval(() => {
      const elapsedMs = Date.now() - recordingStart!;
      w.overlay.setState({ kind: 'listening', elapsedMs, level: 0, warning: max - elapsedMs < 30_000 });
      if (elapsedMs >= max) void onUp(); // graceful cap: stop and process, never discard
    }, 250);
    w.overlay.setState({ kind: 'listening', elapsedMs: 0, level: 0, warning: false });
  };
```

In `onUp`, make three additions — restore in the accidental-tap branch, restore as soon as the audio is captured (so music resumes while Whisper transcribes), and a safety-net restore in `finally` (idempotent — covers `recorder.stop()` throwing):

```typescript
  const onUp = async (): Promise<void> => {
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (recordingStart === null) return;
    if (busy) return;
    const elapsed = Date.now() - recordingStart;
    recordingStart = null;
    if (elapsed < MIN_RECORDING_MS) {
      void ducker.restore();
      try { await w.recorder.stop(); } catch { /* nothing recorded */ }
      w.overlay.setState({ kind: 'hidden' });
      return;
    }
    busy = true;
    w.overlay.setState({ kind: 'processing' });
    try {
      const audio = await w.recorder.stop();
      void ducker.restore(); // audio captured — bring playback back while we transcribe
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
      void ducker.restore(); // safety net: no-op when already restored
      busy = false;
      hideTimer = setTimeout(() => { w.overlay.setState({ kind: 'hidden' }); hideTimer = null; }, 2500);
    }
  };
```

- [ ] **Step 2: Build and run the full test suite**

Run: `npm run build && npm test`
Expected: build succeeds (both tsconfigs + asset copy + dist check), all vitest suites PASS

- [ ] **Step 3: Add manual smoke checklist entries**

In `docs/manual-smoke-checklist.md`, add a section:

```markdown
## Audio ducking

- [ ] Play music. Hold fn — system volume drops to ~20. Release — volume returns to the previous level while transcription is still running.
- [ ] Quick-tap fn (<300ms) while music plays — volume returns (no stuck duck).
- [ ] Mute output, hold fn — volume/mute untouched on release.
- [ ] `shhh config set duck-audio off`, hold fn — volume untouched. Set back `on`.
```

- [ ] **Step 4: Commit**

```bash
git add src/main/session-controller.ts docs/manual-smoke-checklist.md
git commit -m "feat: duck system audio while the dictation hotkey is held"
```

---

## Verification

After all tasks: `npm run build && npm test` green, then walk the new smoke-checklist section with music playing (requires the packaged/dev app running with Accessibility + mic granted).
