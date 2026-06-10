import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';
import { AudioData } from '../shared/types';
import type { IpcMainEvent } from 'electron';

/** Hidden renderer that owns getUserMedia; the mic is acquired per recording, never held idle. */
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
      const ipc = this.win.webContents.ipc;
      const handler = (_e: IpcMainEvent, ab: ArrayBuffer) => {
        clearTimeout(timeout);
        resolve({ pcm: new Int16Array(ab), sampleRate: 16000 });
      };
      const timeout = setTimeout(() => {
        ipc.removeListener('rec:data', handler);
        reject(new Error('Recorder did not respond'));
      }, 5000);
      ipc.once('rec:data', handler);
      this.win.webContents.send('rec:cmd', 'stop');
    });
  }
}
