interface ShhhBridge { invoke(ch: string, ...a: unknown[]): Promise<unknown> }
declare const shhh: ShhhBridge;

interface AppStatus {
  version: string; hotkey: string; ready: boolean;
  stt: { provider: string; model: string; configured: boolean };
  llm: { provider: string; model: string; configured: boolean };
  permissions: { microphone: boolean; accessibility: boolean };
}

export function initHomeView(): { refresh: () => Promise<void> } {
  const root = document.getElementById('view-home')!;
  root.innerHTML = `
    <h3>shhh</h3>
    <p id="run-state"><span class="status-dot">●</span> Running</p>
    <div class="group">
      <div class="row"><label class="name">Hotkey</label><span id="d-hotkey"></span></div>
      <div class="row"><label class="name">Speech-to-text</label><span id="d-stt"></span></div>
      <div class="row"><label class="name">Formatting</label><span id="d-llm"></span></div>
    </div>
    <p id="d-banner" class="note"></p>
    <div class="group row">
      <button class="action" id="d-update">Check for Updates…</button>
      <button class="action" id="d-quit">Quit shhh</button>
    </div>
    <p class="note">shhh <span id="d-version"></span></p>`;

  root.querySelector<HTMLButtonElement>('#d-update')!.addEventListener('click', () => void shhh.invoke('app:checkUpdates'));
  root.querySelector<HTMLButtonElement>('#d-quit')!.addEventListener('click', () => void shhh.invoke('app:quit'));

  async function refresh(): Promise<void> {
    const st = (await shhh.invoke('app:status')) as AppStatus;
    const hotkeyLabel = st.hotkey === 'fn' ? 'fn (🌐)' : st.hotkey;
    root.querySelector('#d-hotkey')!.textContent = `Hold ${hotkeyLabel}`;
    root.querySelector('#d-stt')!.textContent = st.stt.configured
      ? `${st.stt.provider === 'local' ? 'Local Whisper' : st.stt.provider} (${st.stt.model})`
      : 'Not configured';
    root.querySelector('#d-llm')!.textContent = st.llm.configured ? `${st.llm.provider} (${st.llm.model})` : 'Off (raw transcription)';
    root.querySelector('#d-version')!.textContent = `v${st.version}`;
    const needs = !st.permissions.microphone || !st.permissions.accessibility || !st.stt.configured;
    root.querySelector('#d-banner')!.textContent = needs ? '⚠️ Setup incomplete — open Settings to finish.' : '';
  }

  return { refresh };
}
