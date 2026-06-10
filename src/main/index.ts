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
import { HistoryWindow } from './history-window';
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
  const history = new HistoryWindow(store);
  overlay.onClick(() => history.toggle());
  tray = createTray({
    onHistory: () => history.toggle(),
    onSetup: () => void import('./setup-window').then((m) => m.openSetupWindow({ store, apiKeys, dataDir: dir })),
  });

  const { wireSession } = await import('./session-controller');
  const checkPermissions = await wireSession({ store, apiKeys, overlay, recorder, dataDir: dir });

  const rpc = new RpcServer(socketPath(), {
    ...buildHandlers({ store, apiKeys, dataDir: dir, checkPermissions, appVersion: app.getVersion() }),
    'setup.open': async () => { (await import('./setup-window')).openSetupWindow({ store, apiKeys, dataDir: dir }); return 'ok'; },
  });
  await rpc.listen();
});

app.on('window-all-closed', () => { /* background app — keep running */ });
