import { afterEach, expect, test, vi } from 'vitest';
import { OpenAICompatibleSTT } from '../src/core/transcriber/openai-compatible';
import { DeepgramSTT } from '../src/core/transcriber/deepgram';
import { pcmToWav } from '../src/core/audio';

const audio = { pcm: new Int16Array(16000), sampleRate: 16000 };
afterEach(() => vi.unstubAllGlobals());

test('OpenAICompatibleSTT posts multipart to /audio/transcriptions and returns text', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'hello world' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const stt = new OpenAICompatibleSTT({ apiKey: 'k', model: 'whisper-1', baseUrl: 'https://api.openai.com/v1' });
  expect(await stt.transcribe(audio)).toBe('hello world');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
  expect(init.headers.Authorization).toBe('Bearer k');
  expect(init.body).toBeInstanceOf(FormData);
});

test('OpenAICompatibleSTT stitches multiple chunks', async () => {
  // A 60s constant-tone MP3 at 32kbps is ~240KB; a 25KB limit produces ~10 chunks.
  const fetchMock = vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify({ text: 'part' }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const stt = new OpenAICompatibleSTT({ apiKey: 'k', model: 'whisper-1', baseUrl: 'https://x/v1', maxUploadBytes: 25_000 });
  const long = { pcm: new Int16Array(16000 * 60).fill(5000), sampleRate: 16000 };
  const result = await stt.transcribe(long);
  const n = fetchMock.mock.calls.length;
  expect(n).toBeGreaterThan(1);
  expect(result).toBe(Array(n).fill('part').join(' '));
});

test('non-2xx throws with status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
  const stt = new OpenAICompatibleSTT({ apiKey: 'k', model: 'whisper-1', baseUrl: 'https://x/v1' });
  await expect(stt.transcribe(audio)).rejects.toThrow(/401/);
});

test('DeepgramSTT posts WAV body and extracts transcript', async () => {
  const body = { results: { channels: [{ alternatives: [{ transcript: 'deep text' }] }] } };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const stt = new DeepgramSTT({ apiKey: 'dk', model: 'nova-2' });
  expect(await stt.transcribe(audio)).toBe('deep text');
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain('api.deepgram.com/v1/listen');
  expect(init.headers.Authorization).toBe('Token dk');
  expect(Buffer.compare(Buffer.from(init.body), pcmToWav(audio.pcm, 16000))).toBe(0);
});
