import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/renderer', { recursive: true });
for (const f of ['overlay.html', 'overlay.css', 'home.html', 'home.css', 'recorder.html', 'recorder-worklet.js', 'trayTemplate.png', 'trayTemplate@2x.png']) {
  try { cpSync(`renderer/${f}`, `dist/renderer/${f}`); } catch { /* not created yet in early tasks */ }
}
