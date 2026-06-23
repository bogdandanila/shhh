interface ShhhBridge { invoke(ch: string, ...a: unknown[]): Promise<unknown> }
declare const shhh: ShhhBridge;

interface HistoryEntry { id: string; formattedText: string; createdAt: string; unformatted: boolean }

export function initHistoryView(): { refresh: () => Promise<void> } {
  const root = document.getElementById('view-history')!;
  root.innerHTML = `
    <h3>History</h3>
    <input type="text" id="h-search" placeholder="Search…" style="width:100%;margin:8px 0">
    <div id="h-list"></div>`;
  const search = root.querySelector<HTMLInputElement>('#h-search')!;
  const list = root.querySelector<HTMLDivElement>('#h-list')!;

  async function refresh(): Promise<void> {
    const entries = (await shhh.invoke('history:list', search.value || undefined)) as HistoryEntry[];
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = search.value ? 'No matches.' : 'No dictations yet.';
      list.appendChild(empty);
      return;
    }
    for (const e of entries) {
      const div = document.createElement('div');
      div.className = 'entry';
      div.style.cssText = 'padding:8px 0;border-bottom:1px solid #eee;cursor:pointer';
      const text = document.createElement('div');
      text.textContent = e.formattedText;
      const meta = document.createElement('div');
      meta.className = 'note';
      meta.textContent = `${new Date(e.createdAt).toLocaleString()}${e.unformatted ? ' · raw' : ''} · click to copy`;
      div.append(text, meta);
      div.onclick = async () => { await shhh.invoke('history:copy', e.id); div.style.background = '#d4f7d4'; };
      list.appendChild(div);
    }
  }

  search.addEventListener('input', () => void refresh());
  return { refresh };
}
