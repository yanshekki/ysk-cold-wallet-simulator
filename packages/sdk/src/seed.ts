import { sha256 } from '@noble/hashes/sha2';
import { mnemonicToSeedSync } from '@scure/bip39';
import type { BackupKind } from '@cws/contracts';
import { mnemonicFromEntropy } from './entropy';

export function toBip32Seed(
  secret: Uint8Array,
  backup: BackupKind = 'bip39',
  passphrase = '',
): Uint8Array {
  if (backup === 'slip39') {
    return secret;
  }
  return mnemonicToSeedSync(mnemonicFromEntropy(secret), passphrase);
}

/** First 4 bytes of SHA-256(seed) as 8 hex chars. Not secret. */
export function seedFingerprint(seed: Uint8Array): string {
  const hash = sha256(seed);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += hash[i].toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

export function wipeBytes(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const buffer of buffers) {
    buffer?.fill(0);
  }
}

export function passphraseBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
