import { entropyByteLength, type Bip39WordCount } from './entropy';

export type CustomEntropyKind = 'hex' | 'dice';

export function entropyBitsForWordCount(wordCount: Bip39WordCount): number {
  return entropyByteLength(wordCount) * 8;
}

export function minHexChars(wordCount: Bip39WordCount): number {
  return entropyByteLength(wordCount) * 2;
}

/** iancoleman / OneKey: ceil(ENT / log2(6)). */
export function minDiceRolls(wordCount: Bip39WordCount): number {
  return Math.ceil(entropyBitsForWordCount(wordCount) / Math.log2(6));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bitsToBytes(bits: string): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

/**
 * OneKey / iancoleman custom randomness: hex or 6-sided dice.
 * Too few events throw; extra events keep the first ENT bits. BIP39 checksum is applied later.
 */
export function parseCustomEntropy(kind: CustomEntropyKind, input: string, wordCount: Bip39WordCount): Uint8Array {
  const size = entropyByteLength(wordCount);
  const bits = size * 8;
  if (kind === 'hex') {
    let hex = input.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (hex.length % 2 === 1) {
      hex = hex.slice(0, -1);
    }
    if (hex.length < size * 2) {
      throw new Error('too few events');
    }
    return hexToBytes(hex.slice(0, size * 2));
  }
  const dice = input.replace(/[^1-6]/g, '').replace(/6/g, '0');
  if (dice.length < minDiceRolls(wordCount)) {
    throw new Error('too few events');
  }
  let value = 0n;
  for (const digit of dice) {
    value = value * 6n + BigInt(digit);
  }
  let binary = value.toString(2);
  if (binary.length < bits) {
    throw new Error('too few events');
  }
  return bitsToBytes(binary.slice(0, bits));
}

export function bytesToEntropyHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
