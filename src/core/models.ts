import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// sha256 values pinned from huggingface.co/ggerganov/whisper.cpp (see Task 10 Step 1)
export const WHISPER_MODELS = {
  'tiny.en':  { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',  sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', sizeMB: 75 },
  'base.en':  { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', sizeMB: 142 },
  'small.en': { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin', sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d', sizeMB: 466 },
} as const;
export type WhisperModelName = keyof typeof WHISPER_MODELS;

export function modelPath(dataDir: string, name: WhisperModelName): string {
  return join(dataDir, 'models', `ggml-${name}.bin`);
}

export function isModelPresent(dataDir: string, name: string): boolean {
  return name in WHISPER_MODELS && existsSync(modelPath(dataDir, name as WhisperModelName));
}

export function verifyChecksum(file: string, sha256: string): boolean {
  return createHash('sha256').update(readFileSync(file)).digest('hex') === sha256;
}

class ByteCounter extends Transform {
  constructor(private onBytes: (n: number) => void) { super(); }
  _transform(chunk: Buffer, _enc: string, cb: () => void) { this.onBytes(chunk.length); this.push(chunk); cb(); }
}

export async function downloadModel(
  dataDir: string, name: WhisperModelName, onProgress?: (pct: number) => void,
): Promise<string> {
  const { url, sha256 } = WHISPER_MODELS[name];
  const dest = modelPath(dataDir, name);
  mkdirSync(join(dataDir, 'models'), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let seen = 0;
  const tmp = `${dest}.part`;
  const counter = new ByteCounter((n) => { seen += n; if (total && onProgress) onProgress(Math.round((seen / total) * 100)); });
  await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp));
  if (!verifyChecksum(tmp, sha256)) { unlinkSync(tmp); throw new Error('Checksum mismatch — download corrupted, try again'); }
  renameSync(tmp, dest);
  return dest;
}
