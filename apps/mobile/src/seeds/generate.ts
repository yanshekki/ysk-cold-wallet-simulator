import * as Crypto from 'expo-crypto';
import {
  generateEntropy,
  mnemonicFromEntropy,
  type Bip39WordCount,
} from '@cws/sdk';

/**
 * Generate a cryptographically secure BIP39 mnemonic.
 * Uses expo-crypto (Android SecureRandom / iOS SecRandomCopyBytes).
 * NEVER use Math.random or insecure polyfills.
 */
export async function generateSecureMnemonic(wordCount: Bip39WordCount): Promise<string> {
  const entropy = await generateSecureEntropy(wordCount);
  return mnemonicFromEntropy(entropy);
}

export async function generateSecureEntropy(wordCount: Bip39WordCount): Promise<Uint8Array> {
  return generateEntropy(wordCount, async (bytes) => {
    const entropy = await Crypto.getRandomBytesAsync(bytes);
    return entropy instanceof Uint8Array ? entropy : new Uint8Array(entropy);
  });
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
