import { describe, expect, it } from 'vitest';
import {
  entropyByteLength,
  entropyFromMnemonic,
  generateEntropy,
  isValidBip39Mnemonic,
  mnemonicFromEntropy,
  wordCountFromEntropy,
} from './entropy';

describe('entropy helpers', () => {
  it('maps all official BIP39 lengths', () => {
    expect(entropyByteLength(12)).toBe(16);
    expect(entropyByteLength(15)).toBe(20);
    expect(entropyByteLength(18)).toBe(24);
    expect(entropyByteLength(21)).toBe(28);
    expect(entropyByteLength(24)).toBe(32);
  });

  it('round-trips a known 12-word mnemonic through entropy', () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const entropy = entropyFromMnemonic(mnemonic);
    expect(entropy.length).toBe(16);
    expect(wordCountFromEntropy(entropy)).toBe(12);
    expect(mnemonicFromEntropy(entropy)).toBe(mnemonic);
  });

  it('round-trips 15/18/21-word mnemonics', async () => {
    for (const count of [15, 18, 21] as const) {
      const fill = new Uint8Array(entropyByteLength(count)).map((_, i) => (i + 3) % 251);
      const mnemonic = mnemonicFromEntropy(fill);
      expect(mnemonic.split(' ')).toHaveLength(count);
      expect(Array.from(entropyFromMnemonic(mnemonic))).toEqual(Array.from(fill));
    }
  });

  it('rejects invalid mnemonics', () => {
    expect(() => entropyFromMnemonic('not a mnemonic at all')).toThrow(/invalid/);
    expect(isValidBip39Mnemonic('not a mnemonic at all')).toBe(false);
    expect(
      isValidBip39Mnemonic(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    ).toBe(true);
  });

  it('uses the provided rng and never Math.random', async () => {
    const fill = new Uint8Array(16).map((_, i) => i + 1);
    let calledWith = 0;
    const entropy = await generateEntropy(12, async (bytes) => {
      calledWith = bytes;
      return fill;
    });
    expect(calledWith).toBe(16);
    expect(Array.from(entropy)).toEqual(Array.from(fill));
    expect(mnemonicFromEntropy(entropy).split(' ')).toHaveLength(12);
  });

  it('rejects all-zero entropy from a broken rng', async () => {
    await expect(generateEntropy(12, async (n) => new Uint8Array(n))).rejects.toThrow(/zeros/);
  });

  it('reproduces the same mnemonic from the same entropy', () => {
    const entropy = new Uint8Array(32).map((_, i) => (i * 7) % 251);
    expect(mnemonicFromEntropy(entropy)).toBe(mnemonicFromEntropy(entropy));
    expect(mnemonicFromEntropy(entropy).split(' ')).toHaveLength(24);
  });
});
