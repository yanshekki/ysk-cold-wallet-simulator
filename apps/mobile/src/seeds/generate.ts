import * as Crypto from 'expo-crypto';
import {
  generateEntropy,
  isKnownUnsafeMnemonic,
  mixExtraEntropy,
  mnemonicFromEntropy,
  type Bip39WordCount,
} from '@cws/sdk';

/**
 * Generate a cryptographically secure BIP39 mnemonic.
 * Uses expo-crypto (Android SecureRandom / iOS SecRandomCopyBytes).
 * NEVER use Math.random or insecure polyfills.
 */
export async function generateSecureMnemonic(
  wordCount: Bip39WordCount,
  extra?: Uint8Array,
): Promise<string> {
  const entropy = await generateSecureEntropy(wordCount, extra);
  return mnemonicFromEntropy(entropy);
}

export async function generateSecureEntropy(
  wordCount: Bip39WordCount,
  extra?: Uint8Array,
): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let entropy = await generateEntropy(wordCount, async (bytes) => {
      const raw = await Crypto.getRandomBytesAsync(bytes);
      return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    });
    if (extra && extra.length > 0) {
      entropy = mixExtraEntropy(entropy, extra);
    }
    if (!isKnownUnsafeMnemonic(mnemonicFromEntropy(entropy))) {
      return entropy;
    }
  }
  throw new Error('rng produced a well-known test mnemonic');
}

export function newSlotId(): string {
  return Crypto.randomUUID();
}

export async function generateSecureSecret(bytes = 16): Promise<Uint8Array> {
  const entropy = await Crypto.getRandomBytesAsync(bytes);
  const out = entropy instanceof Uint8Array ? entropy : new Uint8Array(entropy);
  if (out.every((byte) => byte === 0)) {
    throw new Error('rng returned all zeros');
  }
  return out;
}
