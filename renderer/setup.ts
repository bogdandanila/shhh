interface ShhhBridge { invoke(ch: string, ...a: unknown[]): Promise<unknown> }
declare const shhh: ShhhBridge;

let closing = false;

async function refresh(): Promise<void> {
  const st = (await shhh.invoke('perm:status')) as Record<string, boolean>;
  document.querySelectorAll<HTMLElement>('.perm').forEach((el) => {
    const ok = st[el.dataset.k!];
    el.querySelector('.state')!.textContent = ok ? '✅' : '⬜';
    (el.querySelector('button') as HTMLButtonElement).style.visibility = ok ? 'hidden' : 'visible';
  });
  const hint = document.getElementById('hint')!;
  const restart = document.getElementById('restart') as HTMLButtonElement;
  if (st.microphone && st.accessibility && st.inputMonitoring) {
    restart.style.display = 'none';
    hint.textContent = 'All set — shhh is ready. Hold your hotkey to dictate.';
    if (!closing) { closing = true; setTimeout(() => window.close(), 1500); }
  } else if (st.microphone && st.accessibility) {
    // Input Monitoring has no query API: it verifies the first time a key event arrives.
    // A tap opened before the grant stays dead, so a restart may be needed to rebind it.
    restart.style.display = 'block';
    hint.textContent = 'Enable Input Monitoring in Settings, then press any key to verify. If the box stays unchecked, restart shhh.';
  } else {
    restart.style.display = 'none';
    hint.textContent = '';
  }
}

document.querySelectorAll<HTMLElement>('.perm button').forEach((btn) => {
  btn.addEventListener('click', () => void shhh.invoke('perm:request', btn.parentElement!.dataset.k));
});
document.getElementById('restart')!.addEventListener('click', () => void shhh.invoke('app:restart'));

setInterval(() => void refresh(), 1500);   // live polling while the user flips toggles
void refresh();
export {};
