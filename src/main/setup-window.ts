import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { checkPermissions, requestPermission } from './permissions';
import { ShhhStore } from '../core/store';
import { ApiKeyStore, KeyProvider } from '../core/api-keys';
import { LlmProvider, SttProvider } from '../shared/types';
import { WHISPER_MODELS, WhisperModelName, isModelPresent, downloadModel } from '../core/models';

export interface SetupDeps { store: ShhhStore; apiKeys: ApiKeyStore; dataDir: string }

let win: BrowserWindow | null = null;
let registered = false;

const CLOUD_STT: SttProvider[] = ['openai', 'groq', 'deepgram'];
const LLM_CLOUD: LlmProvider[] = ['anthropic', 'openai'];

export function openSetupWindow(deps: SetupDeps): void {
  if (!registered) {
    let lastPerms: { microphone: boolean; accessibility: boolean } | null = null;
    ipcMain.handle('perm:status', async () => {
      const p = await checkPermissions();
      // System permission dialogs/Settings trips bury accessory-app windows.
      // The moment a grant lands, surface setup again so the user can continue.
      const granted = lastPerms && ((p.microphone && !lastPerms.microphone) || (p.accessibility && !lastPerms.accessibility));
      lastPerms = p;
      if (granted && win && !win.isDestroyed()) {
        app.focus({ steal: true });
        win.focus();
      }
      return p;
    });
    ipcMain.handle('perm:request', async (_e, which) => {
      await requestPermission(which);
      // The mic dialog resolves right here (no Settings round-trip) — refocus immediately.
      if (which === 'microphone' && win && !win.isDestroyed()) {
        app.focus({ steal: true });
        win.focus();
      }
    });

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

    ipcMain.handle('llm:status', () => {
      const s = deps.store.getSettings();
      return {
        provider: s.llmProvider, model: s.llmModel,
        configured: s.llmProvider !== 'none' && !!s.llmModel && deps.apiKeys.get(s.llmProvider) !== null,
      };
    });

    ipcMain.handle('llm:set', (_e, p: { provider: string; model: string; apiKey: string }) => {
      if (!LLM_CLOUD.includes(p.provider as LlmProvider)) throw new Error(`Unknown provider: ${p.provider}`);
      const model = p.model.trim(), apiKey = p.apiKey.trim();
      if (!model || !apiKey) throw new Error('Model and API key are required');
      deps.apiKeys.set(p.provider as KeyProvider, apiKey);
      deps.store.patchSettings({ llmProvider: p.provider as LlmProvider, llmModel: model });
      return 'ok';
    });

    // Flips settings only — the Keychain entry stays (remove with `shhh config set <provider>.api-key`… or nuke).
    ipcMain.handle('llm:disable', () => {
      deps.store.patchSettings({ llmProvider: 'none', llmModel: '' });
      return 'ok';
    });

    registered = true;
  }
  if (win && !win.isDestroyed()) { win.focus(); return; }
  win = new BrowserWindow({
    width: 480, height: 720, title: 'Set up shhh', resizable: false,
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  win.loadFile(join(rendererDir(), 'setup.html'));
}
