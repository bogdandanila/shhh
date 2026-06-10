interface ShhhBridge { invoke(ch: string, ...a: unknown[]): Promise<unknown> }
declare const shhh: ShhhBridge;

async function refresh(): Promise<void> {
  const st = (await shhh.invoke('perm:status')) as Record<string, boolean>;
  let all = true;
  document.querySelectorAll<HTMLElement>('.perm').forEach((el) => {
    const ok = st[el.dataset.k!];
    el.querySelector('.state')!.textContent = ok ? '✅' : '⬜';
    (el.querySelector('button') as HTMLButtonElement).style.visibility = ok ? 'hidden' : 'visible';
    all &&= ok;
  });
  (document.getElementById('restart') as HTMLButtonElement).style.display = all ? 'block' : 'none';
}

document.querySelectorAll<HTMLElement>('.perm button').forEach((btn) => {
  btn.addEventListener('click', () => void shhh.invoke('perm:request', btn.parentElement!.dataset.k));
});
document.getElementById('restart')!.addEventListener('click', () => void shhh.invoke('app:restart'));

setInterval(() => void refresh(), 1500);   // live polling while the user flips toggles
void refresh();
export {};
