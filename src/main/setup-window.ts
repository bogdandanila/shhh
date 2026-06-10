import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { checkPermissions, requestPermission } from './permissions';

let win: BrowserWindow | null = null;
let registered = false;

export function openSetupWindow(): void {
  if (!registered) {
    ipcMain.handle('perm:status', () => checkPermissions());
    ipcMain.handle('perm:request', (_e, which) => requestPermission(which));
    ipcMain.handle('app:restart', () => { app.relaunch(); app.exit(0); });
    registered = true;
  }
  if (win && !win.isDestroyed()) { win.focus(); return; }
  win = new BrowserWindow({
    width: 460, height: 380, title: 'Set up shhh', resizable: false,
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  win.loadFile(join(rendererDir(), 'setup.html'));
}
