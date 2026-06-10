import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { checkPermissions, requestPermission } from './permissions';
import { ShhhStore } from '../core/store';
import { ApiKeyStore, KeyProvider } from '../core/api-keys';
import { SttProvider } from '../shared/types';
import { WHISPER_MODELS, WhisperModelName, isModelPresent, downloadModel } from '../core/models';

export interface SetupDeps { store: ShhhStore; apiKeys: ApiKeyStore; dataDir: string }

let win: BrowserWindow | null = null;
let registered = false;

const CLOUD_STT: SttProvider[] = ['openai', 'groq', 'deepgram'];

export function openSetupWindow(deps: SetupDeps): void {
  if (!registered) {
    ipcMain.handle('perm:status', () => checkPermissions());
    ipcMain.handle('perm:request', (_e, which) => requestPermission(which));
    ipcMain.handle('app:restart', () => { app.relaunch(); app.exit(0); });

    ipcMain.handle('stt:status', () => {
      const s = deps.store.getSettings();
      const configured = s.sttProvider !== 'unset' && !!s.sttModel && (
        s.sttProvider === 'local'
          ? isModelPresent(deps.dataDir, s.sttModel)
          : deps.apiKeys.get(s.sttProvider) !== null
      );
      return {
        provider: s.sttProvider, model: s.sttModel, configured,
        localModels: (Object.keys(WHISPER_MODELS) as WhisperModelName[]).map((name) => ({
          name, sizeMB: WHISPER_MODELS[name].sizeMB, present: isModelPresent(deps.dataDir, name),
        })),
      };
    });

    ipcMain.handle('stt:useLocal', async (_e, model: string) => {
      if (!(model in WHISPER_MODELS)) throw new Error(`Unknown model: ${model}`);
      if (!isModelPresent(deps.dataDir, model)) {
        await downloadModel(deps.dataDir, model as WhisperModelName, (pct) => {
          if (win && !win.isDestroyed()) win.webContents.send('stt:progress', pct);
        });
      }
      deps.store.patchSettings({ sttProvider: 'local', sttModel: model });
      return 'ok';
    });

    ipcMain.handle('stt:useCloud', (_e, p: { provider: string; model: string; apiKey: string }) => {
      if (!CLOUD_STT.includes(p.provider as SttProvider)) throw new Error(`Unknown provider: ${p.provider}`);
      const model = p.model.trim(), apiKey = p.apiKey.trim();
      if (!model || !apiKey) throw new Error('Model and API key are required');
      deps.apiKeys.set(p.provider as KeyProvider, apiKey); // Keychain — never touches the DB
      deps.store.patchSettings({ sttProvider: p.provider as SttProvider, sttModel: model });
      return 'ok';
    });

    registered = true;
  }
  if (win && !win.isDestroyed()) { win.focus(); return; }
  win = new BrowserWindow({
    width: 480, height: 600, title: 'Set up shhh', resizable: false,
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  win.loadFile(join(rendererDir(), 'setup.html'));
}
