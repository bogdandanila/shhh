import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { parseChecksum, verifyBuffer } from '../src/cli/install';

describe('parseChecksum', () => {
  const sumText = [
    'abc123  shhh-1.0.0-mac.zip',
    'def456  checksums.txt',
  ].join('\n');

  test('returns hash for matching asset name', () => {
    expect(parseChecksum(sumText, 'shhh-1.0.0-mac.zip')).toBe('abc123');
  });

  test('returns undefined when asset name not found', () => {
    expect(parseChecksum(sumText, 'shhh-2.0.0-mac.zip')).toBeUndefined();
  });
});

describe('verifyBuffer', () => {
  const buf = Buffer.from('hello world');
  const correct = createHash('sha256').update(buf).digest('hex');

  test('returns true when hash matches', () => {
    expect(verifyBuffer(buf, correct)).toBe(true);
  });

  test('returns false when hash does not match', () => {
    expect(verifyBuffer(buf, 'deadbeef')).toBe(false);
  });
});
