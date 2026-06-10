import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';

export type OverlayState =
  | { kind: 'hidden' }
  | { kind: 'listening'; elapsedMs: number; level: number; warning: boolean }
  | { kind: 'processing' }
  | { kind: 'done' }
  | { kind: 'copied' }            // paste failed; text is on the clipboard
  | { kind: 'error'; message: string };

export class OverlayWindow {
  private win: BrowserWindow;

  constructor() {
    this.win = new BrowserWindow({
      width: 260, height: 64, frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
      focusable: false,                       // never steal focus from the target app
      webPreferences: { preload: join(__dirname, 'preload.js') },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.loadFile(join(rendererDir(), 'overlay.html'));
  }

  setState(state: OverlayState): void {
    if (state.kind === 'hidden') { this.win.hide(); return; }
    if (!this.win.isVisible()) {
      const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      this.win.setPosition(Math.round(workArea.x + workArea.width / 2 - 130), workArea.y + workArea.height - 96);
      this.win.showInactive();               // show without focusing
    }
    this.win.webContents.send('overlay:state', state);
  }

  onClick(fn: () => void): void {
    this.win.webContents.ipc.on('overlay:clicked', fn);
  }
}
