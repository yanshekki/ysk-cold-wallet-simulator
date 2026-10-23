/// <reference path="./slip39-shim.d.ts" />
import Slip39 from 'slip39';
import { normalizeWords, wordCountOf } from './entropy';

export type Slip39Scheme = {
  threshold: number;
  count: number;
};

export type Slip39Backup = {
  secret: Uint8Array;
  shares: string[];
  scheme: Slip39Scheme;
};

function asBytes(value: number[] | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

export function generateSlip39(
  secret: Uint8Array,
  scheme: Slip39Scheme = { threshold: 1, count: 1 },
): Slip39Backup {
  if (scheme.count < 1 || scheme.count > 16) {
    throw new Error('SLIP-39 share count must be 1–16');
  }
  if (scheme.threshold < 1 || scheme.threshold > scheme.count) {
    throw new Error('SLIP-39 threshold must be between 1 and share count');
  }
  const slip = Slip39.fromArray(Array.from(secret), {
    passphrase: '',
    threshold: 1,
    groups: [[scheme.threshold, scheme.count]],
  });
  const shares = slip.fromPath('r/0').mnemonics.map((item) => normalizeWords(item));
  if (shares.length !== scheme.count) {
    throw new Error(`expected ${scheme.count} SLIP-39 shares, got ${shares.length}`);
  }
  return { secret, shares, scheme };
}

export function combineSlip39(shares: string[], passphrase = ''): Uint8Array {
  const normalized = shares.map(normalizeWords).filter((item) => item.length > 0);
  if (normalized.length === 0) {
    throw new Error('enter at least one SLIP-39 share');
  }
  try {
    return asBytes(Slip39.recoverSecret(normalized, passphrase));
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'invalid SLIP-39 shares');
  }
}

export function isSlip39Mnemonic(mnemonic: string): boolean {
  const count = wordCountOf(mnemonic);
  if (count !== 20 && count !== 33) {
    return false;
  }
  try {
    return Slip39.validateMnemonic(normalizeWords(mnemonic));
  } catch {
    return false;
  }
}
