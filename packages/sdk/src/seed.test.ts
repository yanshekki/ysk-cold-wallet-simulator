import { describe, expect, it } from 'vitest';
import { entropyFromMnemonic } from './entropy';
import { passphraseBytes, seedFingerprint, toBip32Seed, wipeBytes } from './seed';

const FOUNDATION = 'test test test test test test test test test test test junk';

describe('seedFingerprint', () => {
  it('is stable for the same seed and changes with a passphrase', () => {
    const entropy = entropyFromMnemonic(FOUNDATION);
    const empty = toBip32Seed(entropy, 'bip39', '');
    const hidden = toBip32Seed(entropy, 'bip39', 'TREZOR');
    expect(seedFingerprint(empty)).toMatch(/^[0-9A-F]{8}$/);
    expect(seedFingerprint(empty)).toBe(seedFingerprint(empty));
    expect(seedFingerprint(hidden)).not.toBe(seedFingerprint(empty));
  });
});

describe('wipeBytes', () => {
  it('overwrites every byte', () => {
    const buffer = passphraseBytes('secret');
    expect(buffer.some((byte) => byte !== 0)).toBe(true);
    wipeBytes(buffer);
    expect(Array.from(buffer).every((byte) => byte === 0)).toBe(true);
  });
});
