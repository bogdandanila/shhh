import { initHomeView } from './views/home.js';
import { initHistoryView } from './views/history.js';
import { initSettingsView } from './views/settings.js';

interface ShhhBridge {
  invoke(ch: string, ...a: unknown[]): Promise<unknown>;
  on(ch: string, fn: (...a: unknown[]) => void): void;
}
declare const shhh: ShhhBridge;

type Section = 'home' | 'history' | 'settings';

const home = initHomeView();
const history = initHistoryView();
const settings = initSettingsView();

function show(section: Section): void {
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${section}`)!.classList.remove('hidden');
  document.querySelectorAll<HTMLElement>('.navbtn').forEach((b) =>
    b.classList.toggle('active', b.dataset.section === section));
  if (section === 'home') void home.refresh();
  if (section === 'history') void history.refresh();
  if (section === 'settings') void settings.refresh();
}

document.querySelectorAll<HTMLElement>('.navbtn').forEach((b) =>
  b.addEventListener('click', () => show(b.dataset.section as Section)));

shhh.on('nav', (section) => show((section as Section) ?? 'home'));

show('home');
export {};
