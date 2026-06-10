interface ShhhBridge {
  invoke(ch: string, ...a: unknown[]): Promise<unknown>;
  on(ch: string, fn: (...a: unknown[]) => void): void;
}
declare const shhh: ShhhBridge;

interface SttStatus {
  provider: string; model: string; configured: boolean;
  localModels: Array<{ name: string; sizeMB: number; present: boolean }>;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const CLOUD_DEFAULT_MODELS: Record<string, string> = { openai: 'whisper-1', groq: 'whisper-large-v3-turbo', deepgram: 'nova-2' };

let closing = false;
let busy = false; // a download is in flight — don't redraw the form under it
let sttConfigured = false;
let changeRequested = false; // user clicked "Change" — keep the form open even though configured

async function refreshPerms(): Promise<boolean> {
  const st = (await shhh.invoke('perm:status')) as Record<string, boolean>;
  document.querySelectorAll<HTMLElement>('.perm').forEach((el) => {
    const ok = st[el.dataset.k!];
    el.querySelector('.state')!.textContent = ok ? '✅' : '⬜';
    (el.querySelector('button') as HTMLButtonElement).style.visibility = ok ? 'hidden' : 'visible';
  });
  const hint = $('hint');
  const restart = $<HTMLButtonElement>('restart');
  if (st.microphone && st.accessibility && st.inputMonitoring) {
    restart.style.display = 'none';
    if (sttConfigured) {
      hint.textContent = 'All set — shhh is ready. Hold right ⌘ to dictate.';
      if (!closing) { closing = true; setTimeout(() => window.close(), 2000); }
    } else {
      hint.textContent = 'Permissions done — now choose how speech gets transcribed.';
    }
    return true;
  }
  if (st.microphone && st.accessibility) {
    // Input Monitoring has no query API: it verifies the first time a key event arrives.
    // A tap opened before the grant stays dead, so a restart may be needed to rebind it.
    restart.style.display = 'block';
    hint.textContent = 'Enable Input Monitoring in Settings, then press any key to verify. If the box stays unchecked, restart shhh.';
  } else {
    restart.style.display = 'none';
    hint.textContent = '';
  }
  return false;
}

async function refreshStt(): Promise<void> {
  if (busy) return;
  const st = (await shhh.invoke('stt:status')) as SttStatus;
  sttConfigured = st.configured;
  const summary = $('stt-summary');
  const form = $('stt-form');
  if (st.configured && !changeRequested) {
    $('stt-current').textContent = st.provider === 'local' ? `Local Whisper (${st.model})` : `${st.provider} (${st.model})`;
    summary.style.display = 'flex';
    form.style.display = 'none';
  } else {
    summary.style.display = 'none';
    form.style.display = 'block';
    const sel = $<HTMLSelectElement>('local-model');
    const prev = sel.value;
    sel.replaceChildren();
    for (const m of st.localModels) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = `${m.name} — ${m.present ? 'downloaded' : `${m.sizeMB} MB`}${m.name === 'base.en' ? ' (recommended)' : ''}`;
      sel.appendChild(opt);
    }
    sel.value = prev && st.localModels.some((m) => m.name === prev) ? prev : 'base.en';
    syncLocalButton(st);
  }
}

function syncLocalButton(st: SttStatus): void {
  const sel = $<HTMLSelectElement>('local-model');
  const present = st.localModels.find((m) => m.name === sel.value)?.present;
  $<HTMLButtonElement>('local-go').textContent = present ? 'Use' : 'Download & use';
}

function showError(e: unknown): void {
  // Electron prefixes IPC errors with "Error invoking remote method …: Error:" — strip it
  $('stt-error').textContent = String(e instanceof Error ? e.message : e).replace(/^.*Error: /, '');
}

document.querySelectorAll<HTMLInputElement>('input[name="sttmode"]').forEach((r) => {
  r.addEventListener('change', () => {
    $('local-opts').style.display = r.value === 'local' && r.checked ? 'flex' : 'none';
    $('cloud-opts').style.display = r.value === 'cloud' && r.checked ? 'flex' : 'none';
  });
});

$('local-model').addEventListener('change', () => void (async () => {
  syncLocalButton((await shhh.invoke('stt:status')) as SttStatus);
})());

$('local-go').addEventListener('click', () => void (async () => {
  const btn = $<HTMLButtonElement>('local-go');
  const prog = $<HTMLProgressElement>('local-prog');
  busy = true; btn.disabled = true; $('stt-error').textContent = '';
  prog.style.display = 'block'; prog.value = 0;
  try {
    await shhh.invoke('stt:useLocal', $<HTMLSelectElement>('local-model').value);
    changeRequested = false;
  } catch (e) { showError(e); }
  busy = false; btn.disabled = false; prog.style.display = 'none';
  void refreshStt();
})());

$('cloud-provider').addEventListener('change', () => {
  $<HTMLInputElement>('cloud-model').value = CLOUD_DEFAULT_MODELS[$<HTMLSelectElement>('cloud-provider').value];
});

$('cloud-go').addEventListener('click', () => void (async () => {
  $('stt-error').textContent = '';
  try {
    await shhh.invoke('stt:useCloud', {
      provider: $<HTMLSelectElement>('cloud-provider').value,
      model: $<HTMLInputElement>('cloud-model').value,
      apiKey: $<HTMLInputElement>('cloud-key').value,
    });
    $<HTMLInputElement>('cloud-key').value = '';
    changeRequested = false;
  } catch (e) { showError(e); }
  void refreshStt();
})());

$('stt-change').addEventListener('click', () => { changeRequested = true; void refreshStt(); });

document.querySelectorAll<HTMLElement>('.perm button').forEach((btn) => {
  btn.addEventListener('click', () => void shhh.invoke('perm:request', btn.parentElement!.dataset.k));
});
$('restart').addEventListener('click', () => void shhh.invoke('app:restart'));

shhh.on('stt:progress', (pct) => { $<HTMLProgressElement>('local-prog').value = pct as number; });

$<HTMLInputElement>('cloud-model').value = CLOUD_DEFAULT_MODELS.openai;

setInterval(() => { void refreshPerms(); void refreshStt(); }, 1500);
void refreshPerms();
void refreshStt();
export {};
