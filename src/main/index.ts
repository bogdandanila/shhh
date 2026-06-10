import { app, safeStorage } from 'electron';
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

  const { wireSession } = await import('./session-controller');
  const checkPermissions = await wireSession({ store, apiKeys, overlay, recorder, dataDir: dir });

  const rpc = new RpcServer(socketPath(), {
    ...buildHandlers({ store, apiKeys, dataDir: dir, checkPermissions, appVersion: app.getVersion() }),
    'setup.open': async () => { (await import('./setup-window')).openSetupWindow(); return 'ok'; },
  });
  await rpc.listen();
});

app.on('window-all-closed', () => { /* background app — keep running */ });
