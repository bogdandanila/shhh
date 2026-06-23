import { Settings } from '../shared/types';

export interface PermissionFlags { microphone: boolean; accessibility: boolean }

export interface AppStatus {
  version: string;
  hotkey: string;
  stt: { provider: string; model: string; configured: boolean };
  llm: { provider: string; model: string; configured: boolean };
  permissions: PermissionFlags;
  ready: boolean; // permissions granted AND STT usable — i.e. dictation will work
}

/** STT is usable when a provider+model is chosen and its backing resource exists
 *  (local model file present, or cloud API key present). Mirrors buildTranscriber. */
export function isSttConfigured(settings: Settings, deps: { modelPresent: boolean; keyPresent: boolean }): boolean {
  if (settings.sttProvider === 'unset' || !settings.sttModel) return false;
  return settings.sttProvider === 'local' ? deps.modelPresent : deps.keyPresent;
}

/** Formatting is usable when a provider+model is chosen and its API key is present. Mirrors buildFormatter. */
export function isLlmConfigured(settings: Settings, deps: { keyPresent: boolean }): boolean {
  if (settings.llmProvider === 'none' || !settings.llmModel) return false;
  return deps.keyPresent;
}

export function buildAppStatus(args: {
  settings: Settings;
  version: string;
  permissions: PermissionFlags;
  sttModelPresent: boolean;
  sttKeyPresent: boolean;
  llmKeyPresent: boolean;
}): AppStatus {
  const stt = isSttConfigured(args.settings, { modelPresent: args.sttModelPresent, keyPresent: args.sttKeyPresent });
  const llm = isLlmConfigured(args.settings, { keyPresent: args.llmKeyPresent });
  return {
    version: args.version,
    hotkey: args.settings.hotkey,
    stt: { provider: args.settings.sttProvider, model: args.settings.sttModel, configured: stt },
    llm: { provider: args.settings.llmProvider, model: args.settings.llmModel, configured: llm },
    permissions: args.permissions,
    ready: args.permissions.microphone && args.permissions.accessibility && stt,
  };
}
