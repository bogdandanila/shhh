import { expect, test } from 'vitest';
import { resolveHotkeyCode, FN_KEYCODE } from '../src/main/key-listener';

test("resolveHotkeyCode('fn') returns FN_KEYCODE (0x3f = 63)", () => {
  expect(resolveHotkeyCode('fn')).toBe(FN_KEYCODE);
  expect(resolveHotkeyCode('fn')).toBe(0x3f);
  expect(resolveHotkeyCode('fn')).toBe(63);
});

test("resolveHotkeyCode('70') returns 70", () => {
  expect(resolveHotkeyCode('70')).toBe(70);
});
