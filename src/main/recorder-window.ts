import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { AudioData } from '../shared/types';

/** Hidden renderer that owns getUserMedia; kept warm for <50ms start. */
export class RecorderWindow {
  private win: BrowserWindow;

  constructor() {
    this.win = new BrowserWindow({
      show: false, width: 0, height: 0,
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    this.win.loadFile(join(rendererDir(), 'recorder.html'));
  }

  start(): void { this.win.webContents.send('rec:cmd', 'start'); }

  stop(): Promise<AudioData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Recorder did not respond')), 5000);
      ipcMain.once('rec:data', (_e, ab: ArrayBuffer) => {
        clearTimeout(timeout);
        resolve({ pcm: new Int16Array(ab), sampleRate: 16000 });
      });
      this.win.webContents.send('rec:cmd', 'stop');
    });
  }
}
