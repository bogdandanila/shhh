import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/renderer', { recursive: true });
for (const f of ['overlay.html', 'overlay.css', 'history.html', 'setup.html', 'recorder.html', 'recorder-worklet.js']) {
  try { cpSync(`renderer/${f}`, `dist/renderer/${f}`); } catch { /* not created yet in early tasks */ }
}
