import { Settings } from '../../shared/types';
import { ApiKeyStore } from '../api-keys';
import { isModelPresent, modelPath, WhisperModelName } from '../models';
import { Transcriber } from './index';
import { OpenAICompatibleSTT } from './openai-compatible';
import { DeepgramSTT } from './deepgram';
import { LocalWhisperSTT } from './local-whisper';

const BASE_URLS = { openai: 'https://api.openai.com/v1', groq: 'https://api.groq.com/openai/v1' } as const;

/** Returns null when unconfigured (provider unset, key missing, or local model not downloaded). */
export function buildTranscriber(settings: Settings, keys: ApiKeyStore, dataDir: string): Transcriber | null {
  const { sttProvider, sttModel } = settings;
  if (sttProvider === 'unset' || !sttModel) return null;
  if (sttProvider === 'local') {
    if (!isModelPresent(dataDir, sttModel)) return null;
    return new LocalWhisperSTT(modelPath(dataDir, sttModel as WhisperModelName));
  }
  const key = keys.get(sttProvider);
  if (!key) return null;
  if (sttProvider === 'deepgram') return new DeepgramSTT({ apiKey: key, model: sttModel });
  return new OpenAICompatibleSTT({ apiKey: key, model: sttModel, baseUrl: BASE_URLS[sttProvider] });
}
