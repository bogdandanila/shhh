import { expect, test } from 'vitest';
import { resolveHotkeyCode, NAMED_HOTKEYS, DEFAULT_HOTKEY } from '../src/main/key-listener';

test('default hotkey is rcmd (right ⌘, uiohook VC_META_R 0x0e5c)', () => {
  expect(DEFAULT_HOTKEY).toBe('rcmd');
  expect(resolveHotkeyCode('rcmd')).toBe(0x0e5c);
});

test('named hotkeys resolve to uiohook VC_* codes', () => {
  expect(resolveHotkeyCode('lcmd')).toBe(0x0e5b);
  expect(resolveHotkeyCode('ralt')).toBe(0x0e38);
  expect(resolveHotkeyCode('lshift')).toBe(0x002a);
  for (const code of Object.values(NAMED_HOTKEYS)) expect(Number.isInteger(code)).toBe(true);
});

test("legacy 'fn' falls back to rcmd (uiohook cannot observe fn on macOS)", () => {
  expect(resolveHotkeyCode('fn')).toBe(NAMED_HOTKEYS[DEFAULT_HOTKEY]);
});

test('numeric strings resolve to their keycode', () => {
  expect(resolveHotkeyCode('70')).toBe(70);
});

test('garbage hotkeys throw with guidance', () => {
  expect(() => resolveHotkeyCode('bogus')).toThrow(/SHHH_KEY_DEBUG/);
  expect(() => resolveHotkeyCode('-3')).toThrow(/Invalid hotkey/);
});
