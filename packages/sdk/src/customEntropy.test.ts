import { describe, expect, it } from 'vitest';
import { isValidBip39Mnemonic, mnemonicFromEntropy } from './entropy';
import { minDiceRolls, minHexChars, parseCustomEntropy } from './customEntropy';

describe('parseCustomEntropy', () => {
  it('maps official word counts to hex and dice minima', () => {
    expect(minHexChars(12)).toBe(32);
    expect(minHexChars(24)).toBe(64);
    expect(minDiceRolls(12)).toBe(50);
    expect(minDiceRolls(24)).toBe(100);
  });

  it('takes the first ENT bits from extra hex and builds a checksummed mnemonic', () => {
    const hex = `${'11'.repeat(16)}ffffffffffffffff`;
    const entropy = parseCustomEntropy('hex', hex, 12);
    expect(entropy.length).toBe(16);
    expect(Array.from(entropy)).toEqual(Array.from({ length: 16 }, () => 0x11));
    const mnemonic = mnemonicFromEntropy(entropy);
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(isValidBip39Mnemonic(mnemonic)).toBe(true);
  });

  it('discards an odd trailing hex nibble', () => {
    const entropy = parseCustomEntropy('hex', `${'ab'.repeat(16)}f`, 12);
    expect(entropy.length).toBe(16);
    expect(entropy[0]).toBe(0xab);
  });

  it('rejects hex that is too short', () => {
    expect(() => parseCustomEntropy('hex', 'aabbcc', 12)).toThrow(/too few/);
  });

  it('rejects dice below the OneKey minimum', () => {
    expect(() => parseCustomEntropy('dice', '123456'.repeat(4), 12)).toThrow(/too few/);
  });

  it('accepts 50 high-value dice rolls for 12 words', () => {
    const entropy = parseCustomEntropy('dice', '5'.repeat(50), 12);
    expect(entropy.length).toBe(16);
    expect(isValidBip39Mnemonic(mnemonicFromEntropy(entropy))).toBe(true);
  });
});
