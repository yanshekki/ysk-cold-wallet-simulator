import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export type Bip39WordCount = 12 | 15 | 18 | 21 | 24;
export type WordCount = Bip39WordCount | 20;

const BIP39_BYTES: Record<Bip39WordCount, 16 | 20 | 24 | 28 | 32> = {
  12: 16,
  15: 20,
  18: 24,
  21: 28,
  24: 32,
};

const BYTES_TO_WORDS: Record<number, Bip39WordCount> = {
  16: 12,
  20: 15,
  24: 18,
  28: 21,
  32: 24,
};

export function isBip39WordCount(value: number): value is Bip39WordCount {
  return value === 12 || value === 15 || value === 18 || value === 21 || value === 24;
}

export function entropyByteLength(wordCount: Bip39WordCount): 16 | 20 | 24 | 28 | 32 {
  return BIP39_BYTES[wordCount];
}

export function wordCountFromEntropy(entropy: Uint8Array): Bip39WordCount {
  const words = BYTES_TO_WORDS[entropy.length];
  if (!words) {
    throw new Error('entropy must be 16, 20, 24, 28, or 32 bytes');
  }
  return words;
}

export function mnemonicFromEntropy(entropy: Uint8Array): string {
  wordCountFromEntropy(entropy);
  return entropyToMnemonic(entropy, wordlist);
}

export function entropyFromMnemonic(mnemonic: string): Uint8Array {
  const normalized = normalizeWords(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('invalid BIP39 mnemonic');
  }
  return mnemonicToEntropy(normalized, wordlist);
}

export function normalizeWords(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

export function wordCountOf(mnemonic: string): number {
  return normalizeWords(mnemonic).split(' ').filter(Boolean).length;
}

export async function generateEntropy(
  wordCount: Bip39WordCount,
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
