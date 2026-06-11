import { clipboard, systemPreferences } from 'electron';
import { ShhhStore } from '../core/store';
import { ApiKeyStore } from '../core/api-keys';
import { runDictationCycle } from '../core/pipeline';
import { buildTranscriber } from '../core/transcriber/factory';
import { buildFormatter } from '../core/formatter/factory';
import { PermissionStatus } from '../core/rpc-handlers';
import { DEFAULT_HOTKEY, KeyListener, resolveHotkeyCode } from './key-listener';
import { AudioDucker } from './audio-ducker';
import { pasteWithClipboard } from './paster';
import { checkPermissions, allGranted } from './permissions';
import { openSetupWindow } from './setup-window';
import { OverlayWindow } from './overlay-window';
import { RecorderWindow } from './recorder-window';

interface Wiring {
  store: ShhhStore; apiKeys: ApiKeyStore;
  overlay: OverlayWindow; recorder: RecorderWindow; dataDir: string;
}

const MIN_RECORDING_MS = 300; // discard accidental taps

export async function wireSession(w: Wiring): Promise<() => Promise<PermissionStatus>> {
  const ducker = new AudioDucker();
  let recordingStart: number | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;

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

  const settings = w.store.getSettings();
  let hotkeyCode: number;
  try {
    hotkeyCode = resolveHotkeyCode(settings.hotkey);
  } catch (e) {
    console.warn(`${e instanceof Error ? e.message : e} — falling back to ${DEFAULT_HOTKEY}`);
    hotkeyCode = resolveHotkeyCode(DEFAULT_HOTKEY);
  }
  const listener = new KeyListener(hotkeyCode, onDown, () => void onUp());
  // NSEvent monitors installed before Accessibility is granted never fire, so
  // install the moment the app becomes trusted — no restart needed.
  const startWhenTrusted = (): boolean => {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) return false;
    listener.start();
    return true;
  };
  if (!startWhenTrusted()) {
    const poll = setInterval(() => { if (startWhenTrusted()) clearInterval(poll); }, 2000);
  }

  const perms = await checkPermissions();
  const sttReady = buildTranscriber(settings, w.apiKeys, w.dataDir) !== null;
  if (!allGranted(perms) || !sttReady) openSetupWindow({ store: w.store, apiKeys: w.apiKeys, dataDir: w.dataDir });

  return checkPermissions;
}
