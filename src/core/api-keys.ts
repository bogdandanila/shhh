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
  get(provider: KeyProvider) { return this.m.get(provider) ?? null; }
  set(provider: KeyProvider, key: string) { this.m.set(provider, key); }
  delete(provider: KeyProvider) { this.m.delete(provider); }
  providersWithKeys() { return [...this.m.keys()]; }
}

/**
 * Redact an API key for display: never reveal more than ~half the key.
 * ≤4 chars: fully hidden. ≤16: 2-char prefix/suffix. Longer: 7-char prefix + 4-char suffix.
 */
export function redactKey(key: string): string {
  if (!key || key.length <= 4) return '…';
  if (key.length <= 16) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
