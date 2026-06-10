import { uIOhook } from 'uiohook-napi';

/**
 * Hold-to-talk listener over uiohook's CGEventTap.
 *
 * The macOS fn key CANNOT be the hotkey: libuiohook maps kVK_Function to
 * VC_UNDEFINED and its flagsChanged handler only synthesizes key events for
 * shift/ctrl/cmd/option/caps-lock, so fn is dropped before it reaches JS.
 * True fn support needs a native flagsChanged tap (future work).
 *
 * Discover any other key's code with:
 *   SHHH_KEY_DEBUG=1 npm start   (logs every keycode to stdout)
 * then set it via `shhh config set hotkey <code or name>`.
 */
export const NAMED_HOTKEYS: Record<string, number> = {
  // libuiohook VC_* constants (XT-scancode space, NOT macOS keycodes)
  rcmd: 0x0e5c, lcmd: 0x0e5b,
  ralt: 0x0e38, lalt: 0x0038,
  rctrl: 0x0e1d, lctrl: 0x001d,
  rshift: 0x0036, lshift: 0x002a,
};

export const DEFAULT_HOTKEY = 'rcmd';

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
  if (hotkey === 'fn') {
    // Stale configs from when 'fn' was the (never-functional) default.
    console.warn('shhh: the fn key cannot be observed by the key hook — using right ⌘ (rcmd) instead.');
    return NAMED_HOTKEYS[DEFAULT_HOTKEY];
  }
  if (hotkey in NAMED_HOTKEYS) return NAMED_HOTKEYS[hotkey];
  const n = Number(hotkey);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid hotkey "${hotkey}" — use ${Object.keys(NAMED_HOTKEYS).join('/')} or a keycode from SHHH_KEY_DEBUG=1`);
  }
  return n;
}
