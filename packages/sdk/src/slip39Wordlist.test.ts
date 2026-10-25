import { describe, expect, it } from 'vitest';
import { isSlip39Mnemonic } from './slip39';
import { SLIP39_WORDLIST, isSlip39Word } from './slip39Wordlist';

describe('SLIP-39 wordlist', () => {
  it('exports the 1024 official words', () => {
    expect(SLIP39_WORDLIST).toHaveLength(1024);
    expect(SLIP39_WORDLIST[0]).toBe('academic');
    expect(SLIP39_WORDLIST[1023]).toBe('zero');
    expect(isSlip39Word('academic')).toBe(true);
    expect(isSlip39Word('abandon')).toBe(false);
  });

  it('contains every word of a valid share', () => {
    const share =
      'duckling enlarge academic academic agency result length solution fridge kidney coal piece deal husband erode duke ajar critical decision keyboard';
    expect(isSlip39Mnemonic(share)).toBe(true);
    for (const word of share.split(' ')) {
      expect(isSlip39Word(word)).toBe(true);
    }
  });
});
