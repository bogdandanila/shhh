import { expect, test } from 'vitest';
import { InMemoryApiKeyStore, redactKey } from '../src/core/api-keys';

test('redactKey shows prefix and last 4 only', () => {
  expect(redactKey('sk-ant-api03-abcdefgh7f2k')).toBe('sk-ant-…7f2k');
  expect(redactKey('xyz')).toBe('…');
});

test('redactKey never over-reveals short keys', () => {
  expect(redactKey('123456789')).toBe('12…89');        // 9 chars: was fully exposed before
  expect(redactKey('abcd')).toBe('…');
  expect(redactKey('')).toBe('…');
  expect(redactKey('aaaaaaaaaaaaaaaaaaaaaaaa').length).toBeLessThan(24);
});

test('in-memory store round-trips (same interface as Keychain impl)', () => {
  const s = new InMemoryApiKeyStore();
  expect(s.get('anthropic')).toBeNull();
  s.set('anthropic', 'sk-ant-123');
  expect(s.get('anthropic')).toBe('sk-ant-123');
  s.delete('anthropic');
  expect(s.get('anthropic')).toBeNull();
  expect(s.providersWithKeys()).toEqual([]);
});

test('providersWithKeys returns set providers', () => {
  const s = new InMemoryApiKeyStore();
  s.set('anthropic', 'sk-ant-123');
  s.set('groq', 'gsk-456');
  expect(s.providersWithKeys()).toEqual(expect.arrayContaining(['anthropic', 'groq']));
  expect(s.providersWithKeys()).toHaveLength(2);
});
