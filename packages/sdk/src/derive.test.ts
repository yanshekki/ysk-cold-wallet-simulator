import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { FAST_INSPECT_IDS, inspectAddresses, inspectAddressesChunked } from './derive';

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
    expect(rows.find((row) => row.id === 'sol-phantom')?.address).not.toBe(
      rows.find((row) => row.id === 'sol-ledger')?.address,
    );
    expect(rows.find((row) => row.id === 'near')?.address).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.find((row) => row.id === 'atom')?.address.startsWith('cosmos1')).toBe(true);
    expect(rows.find((row) => row.id === 'avax')?.address.startsWith('avax1')).toBe(true);
    expect(rows.find((row) => row.id === 'ada')?.address.startsWith('addr1')).toBe(true);
    expect(rows.find((row) => row.id === 'ton')?.address.length).toBeGreaterThan(40);
    expect(rows.find((row) => row.id === 'trx')?.address.startsWith('T')).toBe(true);
    expect(rows.find((row) => row.id === 'xrp')?.address.startsWith('r')).toBe(true);
  });

  it('can derive a fast subset without Cardano', () => {
    const secret = mnemonicToEntropy(FOUNDATION, wordlist);
    const rows = inspectAddresses(secret, 'bip39', '', undefined, ['eth', 'near']);
    expect(rows.map((row) => row.id)).toEqual(['eth', 'near']);
    expect(rows.find((row) => row.id === 'ada')).toBeUndefined();
  });

  it('chunked inspect matches a single pass and keeps Cardano out of FAST', async () => {
    const secret = mnemonicToEntropy(FOUNDATION, wordlist);
    const sync = inspectAddresses(secret, 'bip39', '', undefined, FAST_INSPECT_IDS);
    const chunked = await inspectAddressesChunked(secret, 'bip39', '', undefined, FAST_INSPECT_IDS, {
      yieldFrame: async () => undefined,
    });
    expect(chunked).toEqual(sync);
    expect(chunked.some((row) => row.id === 'ada')).toBe(false);
  });
});
