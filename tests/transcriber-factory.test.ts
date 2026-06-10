import { expect, test } from 'vitest';
import { buildTranscriber } from '../src/core/transcriber/factory';
import { InMemoryApiKeyStore } from '../src/core/api-keys';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { OpenAICompatibleSTT } from '../src/core/transcriber/openai-compatible';
import { DeepgramSTT } from '../src/core/transcriber/deepgram';

const keys = new InMemoryApiKeyStore();
keys.set('openai', 'k'); keys.set('groq', 'k'); keys.set('deepgram', 'k');
const dataDir = '/tmp/nonexistent-shhh';

test('unset provider -> null', () => {
  expect(buildTranscriber(DEFAULT_SETTINGS, keys, dataDir)).toBeNull();
});
test('cloud providers build; missing key -> null; missing local model -> null', () => {
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'openai', sttModel: 'whisper-1' }, keys, dataDir)).toBeInstanceOf(OpenAICompatibleSTT);
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'groq', sttModel: 'whisper-large-v3' }, keys, dataDir)).toBeInstanceOf(OpenAICompatibleSTT);
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'deepgram', sttModel: 'nova-2' }, keys, dataDir)).toBeInstanceOf(DeepgramSTT);
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'openai', sttModel: 'whisper-1' }, new InMemoryApiKeyStore(), dataDir)).toBeNull();
  expect(buildTranscriber({ ...DEFAULT_SETTINGS, sttProvider: 'local', sttModel: 'base.en' }, keys, dataDir)).toBeNull();
});
