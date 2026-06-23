import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { ShhhStore } from '../core/store';
import { ApiKeyStore, KeyProvider } from '../core/api-keys';
import { LlmProvider, SttProvider } from '../shared/types';
import { WHISPER_MODELS, WhisperModelName, isModelPresent, downloadModel } from '../core/models';
import { DEFAULT_SYSTEM_PROMPT } from '../core/formatter/default-prompt';
import { parseDuration, formatDuration } from '../core/settings';
import { buildAppStatus } from '../core/status';
import { resolveHotkeyCode } from './key-listener';
import { checkPermissions, requestPermission } from './permissions';

export type Section = 'home' | 'history' | 'settings';

export interface HomeDeps {
  store: ShhhStore;
  apiKeys: ApiKeyStore;
  dataDir: string;
  setHotkey: (hotkey: string) => void;
  checkUpdates: () => void;
}

const CLOUD_STT: SttProvider[] = ['openai', 'groq', 'deepgram'];
const LLM_CLOUD: LlmProvider[] = ['anthropic', 'openai'];

let win: BrowserWindow | null = null;
let deps: HomeDeps | null = null;
let registered = false;
let quitting = false;

export function initHomeWindow(d: HomeDeps): void {
  deps = d;
  if (!registered) {
    registerIpc();
    app.on('before-quit', () => { quitting = true; });
    registered = true;
  }
}

export function showHome(section: Section = 'home'): void {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 760, height: 580, minWidth: 640, minHeight: 480, title: 'shhh',
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    win.loadFile(join(rendererDir(), 'home.html'));
    win.webContents.once('did-finish-load', () => win?.webContents.send('nav', section));
    // Background app: closing hides the window; only an explicit Quit exits.
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });
  } else {
    win.webContents.send('nav', section);
  }
  win.show();
  win.focus();
  app.focus({ steal: true });
}

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function registerIpc(): void {
  const d = (): HomeDeps => deps!;

  // ---- Permissions ----
  let lastPerms: { microphone: boolean; accessibility: boolean } | null = null;
  ipcMain.handle('perm:status', async () => {
    const p = await checkPermissions();
    // A grant lands after a Settings round-trip that buried the window — resurface it.
    const granted = lastPerms && ((p.microphone && !lastPerms.microphone) || (p.accessibility && !lastPerms.accessibility));
    lastPerms = p;
    if (granted && win && !win.isDestroyed()) { app.focus({ steal: true }); win.focus(); }
    return p;
  });
  ipcMain.handle('perm:request', async (_e, which) => {
    await requestPermission(which);
    if (which === 'microphone' && win && !win.isDestroyed()) { app.focus({ steal: true }); win.focus(); }
  });

  // ---- Speech-to-text ----
  ipcMain.handle('stt:status', () => {
    const s = d().store.getSettings();
    const configured = s.sttProvider !== 'unset' && !!s.sttModel && (
      s.sttProvider === 'local' ? isModelPresent(d().dataDir, s.sttModel) : d().apiKeys.get(s.sttProvider as KeyProvider) !== null
    );
    return {
      provider: s.sttProvider, model: s.sttModel, configured,
      localModels: (Object.keys(WHISPER_MODELS) as WhisperModelName[]).map((name) => ({
        name, sizeMB: WHISPER_MODELS[name].sizeMB, present: isModelPresent(d().dataDir, name),
      })),
    };
  });
  ipcMain.handle('stt:useLocal', async (_e, model: string) => {
    if (!(model in WHISPER_MODELS)) throw new Error(`Unknown model: ${model}`);
    if (!isModelPresent(d().dataDir, model)) {
      await downloadModel(d().dataDir, model as WhisperModelName, (pct) => send('stt:progress', pct));
    }
    d().store.patchSettings({ sttProvider: 'local', sttModel: model });
    return 'ok';
  });
  ipcMain.handle('stt:useCloud', (_e, p: { provider: string; model: string; apiKey: string }) => {
    if (!CLOUD_STT.includes(p.provider as SttProvider)) throw new Error(`Unknown provider: ${p.provider}`);
    const model = p.model.trim(), apiKey = p.apiKey.trim();
    if (!model || !apiKey) throw new Error('Model and API key are required');
    d().apiKeys.set(p.provider as KeyProvider, apiKey);
    d().store.patchSettings({ sttProvider: p.provider as SttProvider, sttModel: model });
    return 'ok';
  });

  // ---- Formatting (LLM) ----
  ipcMain.handle('llm:status', () => {
    const s = d().store.getSettings();
    return {
      provider: s.llmProvider, model: s.llmModel,
      configured: s.llmProvider !== 'none' && !!s.llmModel && d().apiKeys.get(s.llmProvider as KeyProvider) !== null,
    };
  });
  ipcMain.handle('llm:set', (_e, p: { provider: string; model: string; apiKey: string }) => {
    if (!LLM_CLOUD.includes(p.provider as LlmProvider)) throw new Error(`Unknown provider: ${p.provider}`);
    const model = p.model.trim(), apiKey = p.apiKey.trim();
    if (!model || !apiKey) throw new Error('Model and API key are required');
    d().apiKeys.set(p.provider as KeyProvider, apiKey);
    d().store.patchSettings({ llmProvider: p.provider as LlmProvider, llmModel: model });
    return 'ok';
  });
  ipcMain.handle('llm:disable', () => {
    d().store.patchSettings({ llmProvider: 'none', llmModel: '' });
    return 'ok';
  });

  // ---- History ----
  ipcMain.handle('history:list', (_e, search?: string) => d().store.listHistory({ limit: 50, search }));
  ipcMain.handle('history:copy', (_e, id: string) => {
    const entry = d().store.getHistoryById(id);
    if (entry) clipboard.writeText(entry.formattedText);
    return !!entry;
  });

  // ---- Preferences (config) ----
  ipcMain.handle('config:get', () => {
    const s = d().store.getSettings();
    return {
      hotkey: s.hotkey,
      duckAudio: s.duckAudio,
      maxRecording: formatDuration(s.maxRecordingMs),
      historyRetention: s.historyRetentionMs === null ? 'off' : formatDuration(s.historyRetentionMs),
      loginLaunch: s.loginLaunch,
    };
  });
  ipcMain.handle('config:set', (_e, key: string, value: unknown) => {
    const store = d().store;
    switch (key) {
      case 'hotkey':
        resolveHotkeyCode(String(value)); // throws on an invalid hotkey before persisting
        store.patchSettings({ hotkey: String(value) });
        d().setHotkey(String(value));
        break;
      case 'duckAudio':
        store.patchSettings({ duckAudio: !!value });
        break;
      case 'maxRecording':
        store.patchSettings({ maxRecordingMs: parseDuration(String(value)) });
        break;
      case 'historyRetention':
        store.patchSettings({ historyRetentionMs: value === 'off' ? null : parseDuration(String(value)) });
        break;
      case 'loginLaunch':
        store.patchSettings({ loginLaunch: !!value });
        app.setLoginItemSettings({ openAtLogin: !!value });
        break;
      default:
        throw new Error(`Unknown setting: ${key}`);
    }
    return 'ok';
  });

  // ---- Formatting system prompt ----
  ipcMain.handle('prompt:get', () => d().store.getSettings().systemPrompt);
  ipcMain.handle('prompt:set', (_e, prompt: string) => { d().store.patchSettings({ systemPrompt: prompt }); return 'ok'; });
  ipcMain.handle('prompt:reset', () => { d().store.patchSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT }); return DEFAULT_SYSTEM_PROMPT; });

  // ---- App ----
  ipcMain.handle('app:status', async () => {
    const s = d().store.getSettings();
    const perms = await checkPermissions();
    const sttKeyPresent = s.sttProvider !== 'local' && s.sttProvider !== 'unset'
      ? d().apiKeys.get(s.sttProvider as KeyProvider) !== null : false;
    const llmKeyPresent = s.llmProvider !== 'none' ? d().apiKeys.get(s.llmProvider as KeyProvider) !== null : false;
    return buildAppStatus({
      settings: s, version: app.getVersion(), permissions: perms,
      sttModelPresent: s.sttProvider === 'local' && isModelPresent(d().dataDir, s.sttModel),
      sttKeyPresent, llmKeyPresent,
    });
  });
  ipcMain.handle('app:checkUpdates', () => d().checkUpdates());
  ipcMain.handle('app:quit', () => app.quit());
}
