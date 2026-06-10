import { BrowserWindow, clipboard, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { ShhhStore } from '../core/store';

export class HistoryWindow {
  private win: BrowserWindow | null = null;

  constructor(store: ShhhStore) {
    ipcMain.handle('history:list', (_e, search?: string) => store.listHistory({ limit: 50, search }));
    ipcMain.handle('history:copy', (_e, id: string) => {
      const entry = store.getHistoryById(id);
      if (entry) clipboard.writeText(entry.formattedText);
      return !!entry;
    });
  }

  toggle(): void {
    if (this.win && !this.win.isDestroyed()) { this.win.close(); this.win = null; return; }
    this.win = new BrowserWindow({
      width: 420, height: 480, title: 'shhh history', fullscreenable: false,
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    this.win.loadFile(join(rendererDir(), 'history.html'));
  }
}
