import { expect, test } from 'vitest';
import { resolveHotkeyCode, NAMED_HOTKEYS, DEFAULT_HOTKEY, MODIFIER_FLAG, KeyListener } from '../src/main/key-listener';

test('default hotkey is fn (kVK_Function 0x3f)', () => {
  expect(DEFAULT_HOTKEY).toBe('fn');
  expect(resolveHotkeyCode('fn')).toBe(0x3f);
});

test('named hotkeys resolve to macOS virtual keycodes, all modifiers', () => {
  expect(resolveHotkeyCode('rcmd')).toBe(0x36);
  expect(resolveHotkeyCode('lcmd')).toBe(0x37);
  expect(resolveHotkeyCode('ralt')).toBe(0x3d);
  expect(resolveHotkeyCode('lshift')).toBe(0x38);
  for (const code of Object.values(NAMED_HOTKEYS)) expect(MODIFIER_FLAG[code]).toBeGreaterThan(0);
});

test('numeric strings resolve only when they name a modifier keycode', () => {
  expect(resolveHotkeyCode('54')).toBe(54); // 0x36 rcmd
  expect(() => resolveHotkeyCode('70')).toThrow(/modifier/); // regular keys never reach an Accessibility-only monitor
});

test('garbage hotkeys throw with guidance', () => {
  expect(() => resolveHotkeyCode('bogus')).toThrow(/Invalid hotkey/);
  expect(() => resolveHotkeyCode('-3')).toThrow(/Invalid hotkey/);
});

test('modifier press/release derives from the device-dependent flag bit', () => {
  const l = new KeyListener(0x36, () => {}, () => {});
  expect(l.isDownEvent('flags', 0x36, 0x100010)).toBe(true);   // rcmd bit set → down
  expect(l.isDownEvent('flags', 0x36, 0x100000)).toBe(false);  // bit cleared → up
  expect(l.isDownEvent('flags', 0x3f, 0x800000)).toBe(true);   // fn flag → down
  expect(l.isDownEvent('flags', 0x3f, 0x0)).toBe(false);
});
