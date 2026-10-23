import * as Crypto from 'expo-crypto';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Generate a cryptographically secure BIP39 mnemonic.
 * Uses expo-crypto (Android SecureRandom / iOS SecRandomCopyBytes).
 * NEVER use Math.random or insecure polyfills.
 */
export async function generateSecureMnemonic(wordCount: 12 | 24): Promise<string> {
  const bytes = wordCount === 12 ? 16 : 32;
  const entropy = await Crypto.getRandomBytesAsync(bytes);
  return entropyToMnemonic(entropy, wordlist);
}
