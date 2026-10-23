import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export type WordCount = 12 | 24;

export function entropyByteLength(wordCount: WordCount): 16 | 32 {
  return wordCount === 12 ? 16 : 32;
}

export function wordCountFromEntropy(entropy: Uint8Array): WordCount {
  if (entropy.length === 16) {
    return 12;
  }
  if (entropy.length === 32) {
    return 24;
  }
  throw new Error('entropy must be 16 or 32 bytes');
}

export function mnemonicFromEntropy(entropy: Uint8Array): string {
  wordCountFromEntropy(entropy);
  return entropyToMnemonic(entropy, wordlist);
}

export function entropyFromMnemonic(mnemonic: string): Uint8Array {
  const normalized = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('invalid BIP39 mnemonic');
  }
  return mnemonicToEntropy(normalized, wordlist);
}

export async function generateEntropy(
  wordCount: WordCount,
  rng: (bytes: number) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const size = entropyByteLength(wordCount);
  const entropy = await rng(size);
  if (entropy.length !== size) {
    throw new Error(`rng returned ${entropy.length} bytes, expected ${size}`);
  }
  if (entropy.every((byte) => byte === 0)) {
    throw new Error('rng returned all zeros');
  }
  return entropy;
}
