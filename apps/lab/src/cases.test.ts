import { describe, expect, it } from 'vitest';
import { LAB_ACTIONS } from './cases';

describe('lab catalog', () => {
  it('runs Ledger EIP-712, Bitcoin PSBT, and Trezor ETH tx', () => {
    expect(LAB_ACTIONS.find((item) => item.id === 'eth-712')?.run).toEqual(expect.any(Function));
    expect(LAB_ACTIONS.find((item) => item.id === 'btc-psbt')?.run).toEqual(expect.any(Function));
    expect(LAB_ACTIONS.find((item) => item.id === 'tz-eth-tx')?.run).toEqual(expect.any(Function));
  });

  it('exposes OneKey and Trezor chain catalogs beyond ETH', () => {
    const ids = LAB_ACTIONS.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'ok-sol-addr',
        'ok-near-sign',
        'ok-btc-psbt',
        'ok-eth-712',
        'tz-sol-addr',
        'tz-btc-tx',
        'tz-eth-712',
        'avax-p-addr',
        'avax-x-addr',
        'avax-c-eth-addr',
      ]),
    );
    expect(LAB_ACTIONS.filter((item) => item.brand === 'onekey').length).toBeGreaterThan(12);
    expect(LAB_ACTIONS.filter((item) => item.brand === 'trezor').length).toBeGreaterThan(8);
  });
});
