interface ShhhBridge {
  on(ch: string, fn: (cmd: unknown) => void): void;
  send(ch: string, ...a: unknown[]): void;
  invoke(ch: string, ...a: unknown[]): Promise<unknown>;
}
declare const shhh: ShhhBridge;

// The mic is held ONLY while a recording is in flight — privacy first.
// (Opening the stream costs ~100-300ms at keydown; that lead-in is acceptable,
// keeping the macOS orange mic indicator lit 24/7 is not.)
let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let opening: Promise<void> | null = null;
let chunks: Float32Array[] = [];
let recording = false;

async function openMic(): Promise<void> {
  ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('recorder-worklet.js');
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = (e) => { if (recording) chunks.push(e.data as Float32Array); };
  src.connect(node);
}

function closeMic(): void {
  stream?.getTracks().forEach((t) => t.stop()); // releases the OS mic indicator
  void ctx?.close();
  stream = null;
  ctx = null;
}

function toInt16(parts: Float32Array[]): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) out[off + i] = Math.max(-32768, Math.min(32767, Math.round(p[i] * 32767)));
    off += p.length;
  }
  return out;
}

shhh.on('rec:cmd', async (cmd) => {
  if (cmd === 'start') {
    chunks = [];
    recording = true;
    opening = openMic();
    await opening;
  } else if (cmd === 'stop') {
    recording = false;
    if (opening) await opening.catch(() => { /* mic failed to open; report the empty buffer */ });
    opening = null;
    closeMic();
    const pcm = toInt16(chunks);
    chunks = []; // audio is memory-only; release immediately
    shhh.send('rec:data', pcm.buffer);
  }
});
export {};
