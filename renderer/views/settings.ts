interface ShhhBridge {
  invoke(ch: string, ...a: unknown[]): Promise<unknown>;
  on(ch: string, fn: (...a: unknown[]) => void): void;
}
declare const shhh: ShhhBridge;

interface SttStatus {
  provider: string; model: string; configured: boolean;
  localModels: Array<{ name: string; sizeMB: number; present: boolean }>;
}
interface LlmStatus { provider: string; model: string; configured: boolean }
interface Prefs { hotkey: string; duckAudio: boolean; maxRecording: string; historyRetention: string; loginLaunch: boolean }

const CLOUD_STT_MODELS: Record<string, string> = { openai: 'whisper-1', groq: 'whisper-large-v3-turbo', deepgram: 'nova-2' };
const LLM_MODELS: Record<string, string> = { anthropic: 'claude-haiku-4-5', openai: 'gpt-4o-mini' };
const HOTKEYS = ['fn', 'rcmd', 'lcmd', 'ralt', 'lalt', 'rctrl', 'lctrl', 'rshift', 'lshift'];

function stripErr(e: unknown): string {
  return String(e instanceof Error ? e.message : e).replace(/^.*Error: /, '');
}

export function initSettingsView(): { refresh: () => Promise<void> } {
  const root = document.getElementById('view-settings')!;
  root.innerHTML = `
    <h3>Settings</h3>

    <div class="group">
      <h3>Permissions</h3>
      <div class="perm row" data-k="microphone"><span class="state">⬜</span> 🎤 Microphone <button class="action" style="margin-left:auto">Request</button></div>
      <div class="perm row" data-k="accessibility"><span class="state">⬜</span> ♿ Accessibility <button class="action" style="margin-left:auto">Open Settings</button></div>
    </div>

    <div class="group">
      <h3>Speech-to-text</h3>
      <div id="stt-summary" class="row" style="display:none"><span class="state">✅</span> <span id="stt-current"></span> <button class="action" id="stt-change" style="margin-left:auto">Change</button></div>
      <div id="stt-form">
        <div class="row"><label><input type="radio" name="sttmode" value="local" checked> Local Whisper — private, on-device</label></div>
        <div class="row" id="local-opts">
          <select id="local-model"></select>
          <button class="action" id="local-go">Download &amp; use</button>
          <progress id="local-prog" max="100" value="0" style="display:none"></progress>
        </div>
        <div class="row"><label><input type="radio" name="sttmode" value="cloud"> Cloud API — your key</label></div>
        <div class="row" id="cloud-opts" style="display:none">
          <select id="cloud-provider"><option value="openai">OpenAI</option><option value="groq">Groq</option><option value="deepgram">Deepgram</option></select>
          <input id="cloud-model" type="text"><input id="cloud-key" type="password" placeholder="API key (Keychain)">
          <button class="action" id="cloud-go">Save</button>
        </div>
      </div>
      <div id="stt-error" class="err"></div>
    </div>

    <div class="group">
      <h3>Formatting <span class="note">(optional)</span></h3>
      <div id="llm-summary" class="row" style="display:none"><span class="state">✅</span> <span id="llm-current"></span> <button class="action" id="llm-change" style="margin-left:auto">Change</button> <button class="action" id="llm-off">Disable</button></div>
      <div id="llm-form">
        <div class="note">An LLM pass that strips filler words and fixes punctuation. Skip it and shhh pastes the raw transcription.</div>
        <div class="row">
          <select id="llm-provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select>
          <input id="llm-model" type="text"><input id="llm-key" type="password" placeholder="API key (Keychain)">
          <button class="action" id="llm-go">Save</button>
        </div>
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <label class="note">System prompt</label>
        <textarea id="prompt-text"></textarea>
        <div class="row"><button class="action" id="prompt-save">Save prompt</button><button class="action" id="prompt-reset">Reset to default</button></div>
      </div>
      <div id="llm-error" class="err"></div>
    </div>

    <div class="group">
      <h3>Preferences</h3>
      <div class="row"><label class="name">Hotkey (hold)</label><select id="pref-hotkey"></select></div>
      <div class="row"><label class="name">Duck audio</label><input type="checkbox" id="pref-duck"> <span class="note">lower system volume while recording</span></div>
      <div class="row"><label class="name">Max recording</label><input type="text" id="pref-max" style="width:80px"> <span class="note">e.g. 10m</span></div>
      <div class="row"><label class="name">History retention</label><input type="text" id="pref-retention" style="width:80px"> <span class="note">e.g. 30d, or "off" to keep forever</span></div>
      <div class="row"><label class="name">Launch at login</label><input type="checkbox" id="pref-login"></div>
      <div id="pref-error" class="err"></div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;

  let busy = false, sttChange = false, llmChange = false;

  // ---- Permissions ----
  root.querySelectorAll<HTMLElement>('.perm button').forEach((btn) =>
    btn.addEventListener('click', () => void shhh.invoke('perm:request', (btn.parentElement as HTMLElement).dataset.k)));

  async function refreshPerms(): Promise<void> {
    const st = (await shhh.invoke('perm:status')) as Record<string, boolean>;
    root.querySelectorAll<HTMLElement>('.perm').forEach((el) => {
      const ok = st[el.dataset.k!];
      el.querySelector('.state')!.textContent = ok ? '✅' : '⬜';
      (el.querySelector('button') as HTMLButtonElement).style.visibility = ok ? 'hidden' : 'visible';
    });
  }

  // ---- STT ----
  root.querySelectorAll<HTMLInputElement>('input[name="sttmode"]').forEach((r) =>
    r.addEventListener('change', () => {
      $('local-opts').style.display = r.value === 'local' && r.checked ? 'flex' : 'none';
      $('cloud-opts').style.display = r.value === 'cloud' && r.checked ? 'flex' : 'none';
    }));
  $('cloud-provider').addEventListener('change', () => { $<HTMLInputElement>('cloud-model').value = CLOUD_STT_MODELS[$<HTMLSelectElement>('cloud-provider').value]; });
  $<HTMLInputElement>('cloud-model').value = CLOUD_STT_MODELS.openai;

  function syncLocalBtn(st: SttStatus): void {
    const present = st.localModels.find((m) => m.name === $<HTMLSelectElement>('local-model').value)?.present;
    $('local-go').textContent = present ? 'Use' : 'Download & use';
  }
  $('local-model').addEventListener('change', () => void (async () => syncLocalBtn((await shhh.invoke('stt:status')) as SttStatus))());
  $('local-go').addEventListener('click', () => void (async () => {
    const prog = $<HTMLProgressElement>('local-prog');
    busy = true; $('stt-error').textContent = ''; prog.style.display = 'inline-block'; prog.value = 0;
    try { await shhh.invoke('stt:useLocal', $<HTMLSelectElement>('local-model').value); sttChange = false; }
    catch (e) { $('stt-error').textContent = stripErr(e); }
    busy = false; prog.style.display = 'none'; void refreshStt();
  })());
  $('cloud-go').addEventListener('click', () => void (async () => {
    $('stt-error').textContent = '';
    try {
      await shhh.invoke('stt:useCloud', { provider: $<HTMLSelectElement>('cloud-provider').value, model: $<HTMLInputElement>('cloud-model').value, apiKey: $<HTMLInputElement>('cloud-key').value });
      $<HTMLInputElement>('cloud-key').value = ''; sttChange = false;
    } catch (e) { $('stt-error').textContent = stripErr(e); }
    void refreshStt();
  })());
  $('stt-change').addEventListener('click', () => { sttChange = true; void refreshStt(); });
  shhh.on('stt:progress', (pct) => { $<HTMLProgressElement>('local-prog').value = pct as number; });

  async function refreshStt(): Promise<void> {
    if (busy) return;
    const st = (await shhh.invoke('stt:status')) as SttStatus;
    if (st.configured && !sttChange) {
      $('stt-current').textContent = st.provider === 'local' ? `Local Whisper (${st.model})` : `${st.provider} (${st.model})`;
      $('stt-summary').style.display = 'flex'; $('stt-form').style.display = 'none';
    } else {
      $('stt-summary').style.display = 'none'; $('stt-form').style.display = 'block';
      const sel = $<HTMLSelectElement>('local-model'); const prev = sel.value; sel.replaceChildren();
      for (const m of st.localModels) {
        const opt = document.createElement('option');
        opt.value = m.name; opt.textContent = `${m.name} — ${m.present ? 'downloaded' : `${m.sizeMB} MB`}${m.name === 'base.en' ? ' (recommended)' : ''}`;
        sel.appendChild(opt);
      }
      sel.value = prev && st.localModels.some((m) => m.name === prev) ? prev : 'base.en';
      syncLocalBtn(st);
    }
  }

  // ---- LLM ----
  $('llm-provider').addEventListener('change', () => { $<HTMLInputElement>('llm-model').value = LLM_MODELS[$<HTMLSelectElement>('llm-provider').value]; });
  $<HTMLInputElement>('llm-model').value = LLM_MODELS.anthropic;
  $('llm-go').addEventListener('click', () => void (async () => {
    $('llm-error').textContent = '';
    try {
      await shhh.invoke('llm:set', { provider: $<HTMLSelectElement>('llm-provider').value, model: $<HTMLInputElement>('llm-model').value, apiKey: $<HTMLInputElement>('llm-key').value });
      $<HTMLInputElement>('llm-key').value = ''; llmChange = false;
    } catch (e) { $('llm-error').textContent = stripErr(e); }
    void refreshLlm();
  })());
  $('llm-change').addEventListener('click', () => { llmChange = true; void refreshLlm(); });
  $('llm-off').addEventListener('click', () => void (async () => { await shhh.invoke('llm:disable'); llmChange = false; void refreshLlm(); })());
  $('prompt-save').addEventListener('click', () => void shhh.invoke('prompt:set', $<HTMLTextAreaElement>('prompt-text').value));
  $('prompt-reset').addEventListener('click', () => void (async () => { const def = await shhh.invoke('prompt:reset'); $<HTMLTextAreaElement>('prompt-text').value = def as string; })());

  async function refreshLlm(): Promise<void> {
    const st = (await shhh.invoke('llm:status')) as LlmStatus;
    if (st.configured && !llmChange) {
      $('llm-current').textContent = `${st.provider} (${st.model})`;
      $('llm-summary').style.display = 'flex'; $('llm-form').style.display = 'none';
    } else {
      $('llm-summary').style.display = 'none'; $('llm-form').style.display = 'block';
    }
    $<HTMLTextAreaElement>('prompt-text').value = (await shhh.invoke('prompt:get')) as string;
  }

  // ---- Preferences ----
  const hsel = $<HTMLSelectElement>('pref-hotkey');
  for (const h of HOTKEYS) { const o = document.createElement('option'); o.value = h; o.textContent = h === 'fn' ? 'fn (🌐)' : h; hsel.appendChild(o); }
  const setPref = (key: string, value: unknown): void => void (async () => {
    $('pref-error').textContent = '';
    try { await shhh.invoke('config:set', key, value); } catch (e) { $('pref-error').textContent = stripErr(e); void refreshPrefs(); }
  })();
  hsel.addEventListener('change', () => setPref('hotkey', hsel.value));
  $<HTMLInputElement>('pref-duck').addEventListener('change', (e) => setPref('duckAudio', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('pref-login').addEventListener('change', (e) => setPref('loginLaunch', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('pref-max').addEventListener('change', (e) => setPref('maxRecording', (e.target as HTMLInputElement).value));
  $<HTMLInputElement>('pref-retention').addEventListener('change', (e) => setPref('historyRetention', (e.target as HTMLInputElement).value));

  async function refreshPrefs(): Promise<void> {
    const p = (await shhh.invoke('config:get')) as Prefs;
    hsel.value = p.hotkey;
    $<HTMLInputElement>('pref-duck').checked = p.duckAudio;
    $<HTMLInputElement>('pref-login').checked = p.loginLaunch;
    $<HTMLInputElement>('pref-max').value = p.maxRecording;
    $<HTMLInputElement>('pref-retention').value = p.historyRetention;
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshPerms(), refreshStt(), refreshLlm(), refreshPrefs()]);
  }
  // Live-poll permissions/STT while the Settings view is what users act on.
  setInterval(() => { if (!root.classList.contains('hidden')) { void refreshPerms(); void refreshStt(); } }, 1500);
  return { refresh };
}
