import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { inspectAddresses } from './derive';

const FOUNDATION = 'test test test test test test test test test test test junk';

describe('inspectAddresses', () => {
  it('derives the foundry ETH address and formatted chain rows', () => {
    const secret = mnemonicToEntropy(FOUNDATION, wordlist);
    const rows = inspectAddresses(secret, 'bip39');
    const eth = rows.find((row) => row.id === 'eth');
    expect(eth?.address.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    expect(rows.find((row) => row.id === 'btc-native')?.address.startsWith('bc1q')).toBe(true);
    expect(rows.find((row) => row.id === 'btc-taproot')?.address.startsWith('bc1p')).toBe(true);
    expect(rows.find((row) => row.id === 'btc-legacy')?.address.startsWith('1')).toBe(true);
    expect(rows.find((row) => row.id === 'btc-nested')?.address.startsWith('3')).toBe(true);
    expect(rows.find((row) => row.id === 'trx')?.address.startsWith('T')).toBe(true);
    expect(rows.find((row) => row.id === 'sol-ledger')?.address.length).toBeGreaterThan(30);
    expect(rows.find((row) => row.id === 'sol-trezor')?.address).not.toBe(
      rows.find((row) => row.id === 'sol-ledger')?.address,
    );
  });
});
