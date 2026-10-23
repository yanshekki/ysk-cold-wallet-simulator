import * as Crypto from 'expo-crypto';
import {
  generateEntropy,
  mnemonicFromEntropy,
  type WordCount,
} from '@cws/sdk';

/**
 * Generate a cryptographically secure BIP39 mnemonic.
 * Uses expo-crypto (Android SecureRandom / iOS SecRandomCopyBytes).
 * NEVER use Math.random or insecure polyfills.
 */
export async function generateSecureMnemonic(wordCount: WordCount): Promise<string> {
  const entropy = await generateSecureEntropy(wordCount);
  return mnemonicFromEntropy(entropy);
}

export async function generateSecureEntropy(wordCount: WordCount): Promise<Uint8Array> {
  return generateEntropy(wordCount, async (bytes) => {
    const entropy = await Crypto.getRandomBytesAsync(bytes);
    return entropy instanceof Uint8Array ? entropy : new Uint8Array(entropy);
  });
}

export function newSlotId(): string {
  return Crypto.randomUUID();
}
