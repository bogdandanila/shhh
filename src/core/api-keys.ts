import { Entry } from '@napi-rs/keyring';

export const KEY_PROVIDERS = ['anthropic', 'openai', 'groq', 'deepgram'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

export interface ApiKeyStore {
  get(provider: KeyProvider): string | null;
  set(provider: KeyProvider, key: string): void;
  delete(provider: KeyProvider): void;
  providersWithKeys(): KeyProvider[];
}

/** Each key is its own macOS Keychain item: service "shhh", account = provider. */
export class KeychainApiKeyStore implements ApiKeyStore {
  get(provider: KeyProvider): string | null {
    try { return new Entry('shhh', provider).getPassword(); } catch { return null; }
  }
  set(provider: KeyProvider, key: string): void {
    new Entry('shhh', provider).setPassword(key);
  }
  delete(provider: KeyProvider): void {
    try { new Entry('shhh', provider).deletePassword(); } catch { /* absent is fine */ }
  }
  providersWithKeys(): KeyProvider[] {
    return KEY_PROVIDERS.filter((p) => this.get(p) !== null);
  }
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  private m = new Map<KeyProvider, string>();
  get(p: KeyProvider) { return this.m.get(p) ?? null; }
  set(p: KeyProvider, k: string) { this.m.set(p, k); }
  delete(p: KeyProvider) { this.m.delete(p); }
  providersWithKeys() { return [...this.m.keys()]; }
}

/** Never print full keys anywhere. "sk-ant-…7f2k" style. */
export function redactKey(key: string): string {
  if (key.length <= 8) return '…';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
