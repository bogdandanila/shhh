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
      if (elapsedMs >= max) void onUp(); // graceful cap: stop and process, never discard
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
