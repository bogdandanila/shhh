import { app, dialog, safeStorage } from 'electron';
import { join } from 'node:path';
import { dataDir, socketPath } from './paths';
import { loadOrCreateDbKey, StringEncryptor } from '../core/db-key';
import { ShhhStore } from '../core/store';
import { KeychainApiKeyStore } from '../core/api-keys';
import { RpcServer } from '../core/rpc';
import { buildHandlers } from '../core/rpc-handlers';
import { OverlayWindow } from './overlay-window';
import { RecorderWindow } from './recorder-window';
import { initHomeWindow, showHome } from './home-window';
import { buildAppStatus } from '../core/status';
import { isModelPresent } from '../core/models';
import { KeyProvider } from '../core/api-keys';
import { createTray } from './tray';

let tray: Electron.Tray | null = null; // module-level: Tray must outlive whenReady or GC removes the icon

if (!app.requestSingleInstanceLock()) app.quit();
app.dock?.hide(); // background app: no dock icon

app.whenReady().then(async () => {
  // Quarantined apps run from a randomized read-only path, so TCC re-asks for
  // every permission on every launch — explain the one-time fix instead of looping.
  if (process.execPath.includes('/AppTranslocation/')) {
    dialog.showMessageBoxSync({
      type: 'error', title: 'shhh', message: 'macOS is running shhh from a quarantined location',
      detail: 'Permission grants cannot stick this way (the mic prompt would return forever).\n\n'
        + 'Fix it once in Terminal:\n\nsudo xattr -dr com.apple.quarantine /Applications/shhh.app\n\nthen reopen shhh.',
    });
    app.exit(1);
    return;
  }
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

app.on('window-all-closed', () => { /* background app — keep running */ });
