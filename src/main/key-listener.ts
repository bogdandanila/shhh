/**
 * Hold-to-talk listener over NSEvent monitors (native/keymon).
 * Needs only the Accessibility permission — no Input Monitoring, no CGEventTap.
 *
 * Hotkeys are restricted to MODIFIER keys (fn/⌘/⌥/⌃/⇧): macOS exempts
 * flagsChanged from Input Monitoring, but regular keystrokes never reach an
 * Accessibility-only global monitor. Verify a key with SHHH_KEY_DEBUG=1.
 *
 * IMPORTANT: monitors installed before Accessibility is granted never fire —
 * call start() only once the app is trusted (session-controller polls for it).
 */
export const NAMED_HOTKEYS: Record<string, number> = {
  fn: 0x3f,
  rcmd: 0x36, lcmd: 0x37,
  ralt: 0x3d, lalt: 0x3a,
  rctrl: 0x3e, lctrl: 0x3b,
  rshift: 0x3c, lshift: 0x38,
};

export const DEFAULT_HOTKEY = 'fn';

// Modifier keys arrive as flagsChanged; pressed-vs-released comes from the
// device-dependent bit for that specific key in modifierFlags.
export const MODIFIER_FLAG: Record<number, number> = {
  0x36: 0x0010, 0x37: 0x0008,   // right/left ⌘
  0x3c: 0x0004, 0x38: 0x0002,   // right/left shift
  0x3e: 0x2000, 0x3b: 0x0001,   // right/left ctrl
  0x3d: 0x0040, 0x3a: 0x0020,   // right/left option
  0x3f: 0x800000,               // fn (NSEventModifierFlagFunction)
};

interface KeymonModule {
  start(cb: (type: string, keyCode: number, flags: number) => void): void;
  stop(): void;
}

export class KeyListener {
  private down = false;
  private started = false;

  constructor(private hotkeyCode: number, private onDown: () => void, private onUp: () => void) {}

  /** Visible for tests: derives pressed-state from a keymon event. */
  isDownEvent(type: string, keyCode: number, flags: number): boolean {
    if (type === 'flags') {
      const mask = MODIFIER_FLAG[keyCode];
      return mask ? (flags & mask) !== 0 : !this.down; // unknown modifier: alternate
    }
    return type === 'down';
  }

  start(): void {
    if (this.started) return;
    // Lazy require: the native module must not load at import time (node-ABI test runs).
    const keymon = require('keymon') as KeymonModule;
    keymon.start((type, keyCode, flags) => {
      if (process.env.SHHH_KEY_DEBUG && type !== 'up') console.log(type, keyCode);
      if (keyCode !== this.hotkeyCode) return;
      const isDown = this.isDownEvent(type, keyCode, flags);
      if (isDown && !this.down) { this.down = true; this.onDown(); }
      else if (!isDown && this.down) { this.down = false; this.onUp(); }
    });
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    (require('keymon') as KeymonModule).stop();
    this.started = false;
  }
}

export function resolveHotkeyCode(hotkey: string): number {
  if (hotkey in NAMED_HOTKEYS) return NAMED_HOTKEYS[hotkey];
  const n = Number(hotkey);
  // Modifier keys only: macOS exempts flagsChanged observation from Input
  // Monitoring; regular keystrokes never reach an Accessibility-only monitor.
  if (Number.isInteger(n) && MODIFIER_FLAG[n]) return n;
  throw new Error(`Invalid hotkey "${hotkey}" — must be a modifier key: ${Object.keys(NAMED_HOTKEYS).join('/')}`);
}
