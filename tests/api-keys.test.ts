import { expect, test } from 'vitest';
import { InMemoryApiKeyStore, redactKey } from '../src/core/api-keys';

test('redactKey shows prefix and last 4 only', () => {
  expect(redactKey('sk-ant-api03-abcdefgh7f2k')).toBe('sk-ant-…7f2k');
  expect(redactKey('xyz')).toBe('…');
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
