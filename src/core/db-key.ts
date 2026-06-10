import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Implemented by Electron safeStorage in production, fakes in tests. */
export interface StringEncryptor {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

export function loadOrCreateDbKey(dataDir: string, enc: StringEncryptor): string {
  const file = join(dataDir, 'db.key.enc');
  if (existsSync(file)) return enc.decrypt(readFileSync(file));
  const key = randomBytes(32).toString('hex');
  writeFileSync(file, enc.encrypt(key), { mode: 0o600 });
  return key;
}
