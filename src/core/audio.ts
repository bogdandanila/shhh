// TS compiles `import()` to require() under module:CommonJS, which can't load ESM packages.
// Real CJS modules (Node/Electron) have `module.id` set to the file path; Vitest injects a
// stub `module` object with only `exports` but no `id`.  When we detect a real CJS context
// we route through Function() so the string literal `import(s)` is evaluated at runtime by
// V8 as a genuine dynamic import rather than being downleveled to require() by tsc.
/* eslint-disable @typescript-eslint/no-implied-eval */
declare const module: { id?: string; exports: unknown } | undefined;
const _isCJS = typeof module !== 'undefined' && typeof (module as any).id === 'string';
// eslint-disable-next-line no-new-func
const _dynamicImportCJS = _isCJS ? (new Function('s', 'return import(s)') as (s: string) => Promise<unknown>) : null;

type LamejsModule = {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
    encodeBuffer(pcm: Int16Array): Int8Array;
    flush(): Int8Array;
  };
};
let lamejsPromise: Promise<LamejsModule> | null = null;
function loadLamejs(): Promise<LamejsModule> {
  if (!lamejsPromise) {
    lamejsPromise = (_isCJS
      ? _dynamicImportCJS!('@breezystack/lamejs')
      : import('@breezystack/lamejs')
    ) as Promise<LamejsModule>;
  }
  return lamejsPromise;
}

export function pcmToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataLen = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22);                       // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);          // byte rate
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataLen).copy(buf, 44);
  return buf;
}

export async function pcmToMp3(pcm: Int16Array, sampleRate: number, kbps = 32): Promise<Buffer> {
  const { Mp3Encoder } = await loadLamejs();
  const enc = new Mp3Encoder(1, sampleRate, kbps);
  const chunks: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += 1152) { // 1152 = MPEG-1 Layer III frame size in samples
    const out = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (out.length) chunks.push(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(Buffer.from(tail.buffer, tail.byteOffset, tail.byteLength));
  return Buffer.concat(chunks);
}

/**
 * Split PCM at the quietest 100ms window near each required cut point.
 *
 * Returns subarray views of the input — callers must not mutate the source PCM
 * after calling this function.  When no quiet window exists within the search
 * range (e.g. the remaining audio is shorter than the 100ms window), the
 * function falls back to a hard cut at the ideal boundary.
 */
export function splitOnSilence(
  pcm: Int16Array, sampleRate: number, opts: { maxPartSamples: number },
): Int16Array[] {
  if (pcm.length <= opts.maxPartSamples) return [pcm];
  const win = Math.floor(sampleRate / 10); // 100ms
  const parts: Int16Array[] = [];
  let start = 0;
  while (pcm.length - start > opts.maxPartSamples) {
    const idealCut = start + opts.maxPartSamples;
    // search ±10% around the ideal cut for the quietest window
    const radius = Math.floor(opts.maxPartSamples * 0.1);
    let bestAt = idealCut, bestEnergy = Infinity;
    for (let at = Math.max(start + win, idealCut - radius); at <= Math.min(pcm.length - win, idealCut); at += win) {
      let e = 0;
      for (let i = at; i < at + win; i++) e += Math.abs(pcm[i]);
      if (e < bestEnergy) { bestEnergy = e; bestAt = at; }
    }
    parts.push(pcm.subarray(start, bestAt));
    start = bestAt;
  }
  parts.push(pcm.subarray(start));
  return parts;
}

export interface UploadPart { data: Buffer; mime: string; filename: string }

/**
 * WAV when it fits the provider limit; otherwise MP3, chunked on silence if still too big.
 *
 * The 0.9 safety factor when computing maxPartSamples accounts for the fact
 * that MP3 bitrate varies slightly with audio content, so we target 90% of
 * the byte limit to avoid a re-encoded chunk accidentally exceeding it.
 */
export async function prepareUploads(pcm: Int16Array, sampleRate: number, maxBytes: number): Promise<UploadPart[]> {
  const wav = pcmToWav(pcm, sampleRate);
  if (wav.length <= maxBytes) return [{ data: wav, mime: 'audio/wav', filename: 'audio.wav' }];
  const mp3 = await pcmToMp3(pcm, sampleRate);
  if (mp3.length <= maxBytes) return [{ data: mp3, mime: 'audio/mpeg', filename: 'audio.mp3' }];
  // mp3 bytes scale ~linearly with samples; chunk PCM so each part encodes under the limit
  const ratio = mp3.length / pcm.length;
  const maxPartSamples = Math.floor((maxBytes * 0.9) / ratio);
  const parts = splitOnSilence(pcm, sampleRate, { maxPartSamples });
  const encoded = await Promise.all(parts.map((p) => pcmToMp3(p, sampleRate)));
  return encoded.map((data, i) => ({ data, mime: 'audio/mpeg', filename: `audio-${i}.mp3` }));
}
