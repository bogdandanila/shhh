import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Implemented by Electron safeStorage in production, fakes in tests. */
export interface StringEncryptor {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

export function loadOrCreateDbKey(dataDir: string, enc: StringEncryptor): string {
  const file = join(dataDir, 'db.key.enc');
  if (existsSync(file)) {
    chmodSync(file, 0o600);
    try {
      return enc.decrypt(readFileSync(file));
    } catch {
      throw new Error(
        'Could not unlock the database key (the file may be corrupted, or the app signature changed). ' +
        'Your data is unreadable without it — run "shhh nuke" to start fresh.',
      );
    }
  }
  const key = randomBytes(32).toString('hex');
  writeFileSync(file, enc.encrypt(key), { mode: 0o600 });
  return key;
}
