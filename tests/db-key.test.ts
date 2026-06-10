import { expect, test } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

// Fix 1 — enforce mode 600 on load path
test('heals weak permissions: chmod 644 then load restores mode to 600 and key is unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const file = join(dir, 'db.key.enc');
  const key = loadOrCreateDbKey(dir, fakeEnc);
  chmodSync(file, 0o644);
  expect(statSync(file).mode & 0o777).toBe(0o644); // confirm weakened
  const key2 = loadOrCreateDbKey(dir, fakeEnc);
  expect(statSync(file).mode & 0o777).toBe(0o600); // healed
  expect(key2).toBe(key); // same key returned
});

// Fix 2 — clear error on decrypt failure
test('throws a clear message when decrypt fails (corrupt file / changed signature)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const file = join(dir, 'db.key.enc');
  writeFileSync(file, Buffer.from('garbage'), { mode: 0o600 });
  const brokenEnc: StringEncryptor = {
    encrypt: fakeEnc.encrypt,
    decrypt: () => { throw new Error('decryption failed'); },
  };
  expect(() => loadOrCreateDbKey(dir, brokenEnc)).toThrow(/unlock the database key/);
});
