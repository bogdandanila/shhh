import { Settings, SttProvider, LlmProvider } from '../shared/types';
import { ShhhStore } from './store';
import { ApiKeyStore, KEY_PROVIDERS, KeyProvider, redactKey } from './api-keys';
import { parseDuration, formatDuration } from './settings';
import { DEFAULT_SYSTEM_PROMPT } from './formatter/default-prompt';
import { Handlers } from './rpc';
import { isModelPresent } from './models';

export interface PermissionStatus { microphone: boolean; accessibility: boolean }

export interface HandlerDeps {
  store: ShhhStore;
  apiKeys: ApiKeyStore;
  dataDir: string;
  checkPermissions(): Promise<PermissionStatus>;
  appVersion: string;
}

const STT_PROVIDERS: SttProvider[] = ['unset', 'local', 'openai', 'groq', 'deepgram'];
const LLM_PROVIDERS: LlmProvider[] = ['none', 'anthropic', 'openai'];

export function buildHandlers(deps: HandlerDeps): Handlers {
  const { store, apiKeys } = deps;

  const setters: Record<string, (v: string) => void> = {
    'stt.provider': (v) => {
      if (!STT_PROVIDERS.includes(v as SttProvider)) throw new Error(`stt.provider must be one of: ${STT_PROVIDERS.join(', ')}`);
      store.patchSettings({ sttProvider: v as SttProvider });
    },
    'stt.model': (v) => store.patchSettings({ sttModel: v }),
    'llm.provider': (v) => {
      if (!LLM_PROVIDERS.includes(v as LlmProvider)) throw new Error(`llm.provider must be one of: ${LLM_PROVIDERS.join(', ')}`);
      store.patchSettings({ llmProvider: v as LlmProvider });
    },
    'llm.model': (v) => store.patchSettings({ llmModel: v }),
    hotkey: (v) => store.patchSettings({ hotkey: v }),
    'max-recording': (v) => store.patchSettings({ maxRecordingMs: parseDuration(v) }),
    'history-retention': (v) => store.patchSettings({ historyRetentionMs: v === 'off' ? null : parseDuration(v) }),
    'login-launch': (v) => store.patchSettings({ loginLaunch: v === 'on' }),
    'duck-audio': (v) => store.patchSettings({ duckAudio: v === 'on' }),
  };
  for (const p of KEY_PROVIDERS) {
    setters[`${p}.api-key`] = (v) => apiKeys.set(p, v);
  }

  function configView(s: Settings): Record<string, string> {
    const out: Record<string, string> = {
      'stt.provider': s.sttProvider, 'stt.model': s.sttModel,
      'llm.provider': s.llmProvider, 'llm.model': s.llmModel,
      hotkey: s.hotkey,
      'max-recording': formatDuration(s.maxRecordingMs),
      'history-retention': s.historyRetentionMs === null ? 'off' : formatDuration(s.historyRetentionMs),
      'login-launch': s.loginLaunch ? 'on' : 'off',
      'duck-audio': s.duckAudio ? 'on' : 'off',
    };
    for (const p of KEY_PROVIDERS) {
      const k = apiKeys.get(p);
      if (k) out[`${p}.api-key`] = redactKey(k);
    }
    return out;
  }

  return {
    'config.set': async (params) => {
      const { key, value } = params as { key: string; value: string };
      const setter = setters[key];
      if (!setter) throw new Error(`Unknown config key: ${key}`);
      setter(value);
      return 'ok';
    },
    'config.get': async (params) => {
      const { key } = (params ?? {}) as { key?: string };
      const view = configView(store.getSettings());
      if (!key) return view;
      if (!(key in setters)) throw new Error(`Unknown config key: ${key}`);
      return { [key]: view[key] ?? '' };
    },
    'prompt.get': async () => store.getSettings().systemPrompt,
    'prompt.set': async (params) => { store.patchSettings({ systemPrompt: (params as { prompt: string }).prompt }); return 'ok'; },
    'prompt.reset': async () => { store.patchSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT }); return 'ok'; },
    'history.list': async (params) => {
      const { limit = 20, search } = (params ?? {}) as { limit?: number; search?: string };
      return store.listHistory({ limit, search });
    },
    'history.get': async (params) => {
      const e = store.getHistoryById((params as { id: string }).id);
      if (!e) throw new Error('History entry not found');
      return e;
    },
    'history.clear': async () => { store.clearHistory(); return 'ok'; },
    status: async () => {
      const s = store.getSettings();
      return {
        version: deps.appVersion,
        sttConfigured: s.sttProvider !== 'unset' && (s.sttProvider !== 'local' ? apiKeys.get(s.sttProvider as KeyProvider) !== null : isModelPresent(deps.dataDir, s.sttModel)),
        llmConfigured: s.llmProvider !== 'none' && apiKeys.get(s.llmProvider as KeyProvider) !== null,
        sttProvider: s.sttProvider, llmProvider: s.llmProvider,
      };
    },
    doctor: async () => {
      const perms = await deps.checkPermissions();
      const s = store.getSettings();
      return { ...perms, sttProvider: s.sttProvider, modelPresent: s.sttProvider !== 'local' || isModelPresent(deps.dataDir, s.sttModel) };
    },
    nuke: async () => {
      for (const p of apiKeys.providersWithKeys()) apiKeys.delete(p);
      store.wipeHistory();
      store.patchSettings({
        sttProvider: 'unset', sttModel: '', llmProvider: 'none', llmModel: '', systemPrompt: DEFAULT_SYSTEM_PROMPT,
        hotkey: 'fn', maxRecordingMs: 600_000, historyRetentionMs: null, loginLaunch: false, duckAudio: true,
      });
      return 'ok';
    },
  };
}
