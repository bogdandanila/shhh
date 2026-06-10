import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, parseDuration, formatDuration, mergeSettings } from '../src/core/settings';

describe('parseDuration', () => {
  test('parses s/m/h/d', () => {
    expect(parseDuration('45s')).toBe(45_000);
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('30d')).toBe(2_592_000_000);
  });
  test('rejects garbage', () => {
    expect(() => parseDuration('ten minutes')).toThrow();
    expect(() => parseDuration('-5m')).toThrow();
  });
});

test('formatDuration round-trips', () => {
  expect(formatDuration(600_000)).toBe('10m');
});

test('formatDuration falls back to ms for non-exact values', () => {
  expect(formatDuration(500)).toBe('500ms');
  expect(formatDuration(90_000)).toBe('90s');
});

describe('defaults', () => {
  test('providers default to unset/none per spec', () => {
    expect(DEFAULT_SETTINGS.sttProvider).toBe('unset');
    expect(DEFAULT_SETTINGS.llmProvider).toBe('none');
    expect(DEFAULT_SETTINGS.maxRecordingMs).toBe(600_000);
    expect(DEFAULT_SETTINGS.hotkey).toBe('rcmd');
    expect(DEFAULT_SETTINGS.systemPrompt.length).toBeGreaterThan(50);
  });
});

test('mergeSettings overlays partials onto defaults', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { sttProvider: 'local', sttModel: 'base.en' });
  expect(s.sttProvider).toBe('local');
  expect(s.llmProvider).toBe('none'); // untouched
});
