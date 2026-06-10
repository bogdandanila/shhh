interface ShhhBridge {
  on(ch: string, fn: (s: unknown) => void): void;
  send(ch: string, ...args: unknown[]): void;
  invoke(ch: string, ...args: unknown[]): Promise<unknown>;
}
declare const shhh: ShhhBridge;

const pill = document.getElementById('pill')!;
const label = document.getElementById('label')!;
const timer = document.getElementById('timer')!;

pill.addEventListener('click', () => shhh.send('overlay:clicked'));

shhh.on('overlay:state', (s) => {
  const state = s as { kind: string; elapsedMs?: number; warning?: boolean; message?: string };
  pill.className = state.kind + (state.warning ? ' warning' : '');
  timer.textContent = '';
  if (state.kind === 'listening') {
    label.textContent = 'Listening';
    const secs = Math.floor((state.elapsedMs ?? 0) / 1000);
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  } else if (state.kind === 'processing') label.textContent = 'Processing…';
  else if (state.kind === 'done') label.textContent = '✓ Pasted';
  else if (state.kind === 'copied') label.textContent = 'Copied — press ⌘V';
  else if (state.kind === 'error') label.textContent = `⚠ ${state.message}`;
});
export {};
