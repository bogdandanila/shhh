interface ShhhBridge { invoke(ch: string, ...a: unknown[]): Promise<unknown> }
declare const shhh: ShhhBridge;

const list = document.getElementById('list')!;
const search = document.getElementById('search') as HTMLInputElement;

async function render(): Promise<void> {
  const entries = (await shhh.invoke('history:list', search.value || undefined)) as
    { id: string; formattedText: string; createdAt: string; unformatted: boolean }[];
  list.replaceChildren();
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    const text = document.createElement('div');
    text.textContent = e.formattedText;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${new Date(e.createdAt).toLocaleString()}${e.unformatted ? ' · raw' : ''} · click to copy`;
    div.append(text, meta);
    div.onclick = async () => { await shhh.invoke('history:copy', e.id); div.style.background = '#d4f7d4'; };
    list.appendChild(div);
  }
}
search.addEventListener('input', () => void render());
void render();
export {};
