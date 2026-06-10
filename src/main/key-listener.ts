import { uIOhook } from 'uiohook-napi';

/**
 * Hold-to-talk listener. The macOS fn key arrives as a keydown/keyup pair via
 * uiohook's CGEventTap. Discover the keycode on your machine with:
 *   SHHH_KEY_DEBUG=1 npm start   (logs every keycode to stdout)
 * then set it via `shhh config set hotkey <code>`. "fn" maps to FN_KEYCODE below.
 */
export const FN_KEYCODE = 0x3f; // kVK_Function — verify once with SHHH_KEY_DEBUG and correct if needed

export class KeyListener {
  private down = false;
  private started = false;

  constructor(
    private hotkeyCode: number,
    private onDown: () => void,
    private onUp: () => void,
    // Any delivered event proves Input Monitoring is granted, even if it isn't the hotkey.
    private onAnyKeyEvent?: () => void,
  ) {}

  start(): void {
    if (this.started) return;
    uIOhook.on('keydown', (e) => {
      if (process.env.SHHH_KEY_DEBUG) console.log('keydown', e.keycode);
      this.onAnyKeyEvent?.();
      if (e.keycode === this.hotkeyCode && !this.down) { this.down = true; this.onDown(); }
    });
    uIOhook.on('keyup', (e) => {
      if (e.keycode === this.hotkeyCode && this.down) { this.down = false; this.onUp(); }
    });
    uIOhook.start();
    this.started = true;
  }

  stop(): void { if (this.started) { uIOhook.stop(); this.started = false; } }
}

export function resolveHotkeyCode(hotkey: string): number {
  return hotkey === 'fn' ? FN_KEYCODE : Number(hotkey);
}
