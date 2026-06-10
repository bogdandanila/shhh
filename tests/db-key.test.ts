import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateDbKey, StringEncryptor } from '../src/core/db-key';

// XOR "encryptor" — stands in for Electron safeStorage in tests
const fakeEnc: StringEncryptor = {
  encrypt: (s) => Buffer.from(Uint8Array.from(Buffer.from(s, 'utf8')).map((b) => b ^ 0x42)),
  decrypt: (b) => Buffer.from(Uint8Array.from(b).map((x) => x ^ 0x42)).toString('utf8'),
};

test('creates a 64-hex-char key, persists encrypted, mode 600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const key = loadOrCreateDbKey(dir, fakeEnc);
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  const onDisk = readFileSync(join(dir, 'db.key.enc'));
  expect(onDisk.toString('utf8')).not.toContain(key); // not plaintext
  expect(statSync(join(dir, 'db.key.enc')).mode & 0o777).toBe(0o600);
});

test('second call returns the same key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const a = loadOrCreateDbKey(dir, fakeEnc);
  const b = loadOrCreateDbKey(dir, fakeEnc);
  expect(b).toBe(a);
});
