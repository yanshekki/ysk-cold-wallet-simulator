import { describe, expect, it } from 'vitest';
import { describeSigning, parseEthTx } from '@cws/contracts';
import { bytesToHex, encodePath, hardened } from './apdu';
import { eip1559EthTx, eip1559Signed, eip2930EthTx, eip4844EthTx, garbageEthTx, legacyEthTx } from './rlp';

describe('lab ETH fixtures', () => {
  it('decodes legacy / 2930 / 1559 and fails garbage', () => {
    expect(parseEthTx(legacyEthTx())?.type).toBe('legacy');
    expect(parseEthTx(eip2930EthTx())?.type).toBe('eip2930');
    expect(parseEthTx(eip1559EthTx())?.type).toBe('eip1559');
    expect(parseEthTx(garbageEthTx())).toBeNull();
    expect(garbageEthTx()[0]).toBe(0x03);
    expect(garbageEthTx().length).toBeGreaterThan(4);
    expect(eip4844EthTx()[0]).toBe(0x03);
  });

  it('describeSigning labels 1559 and marks garbage as decodeFailed', () => {
    const ok = describeSigning({
      brand: 'ledger',
      kind: 'sign',
      title: 'Sign Ethereum transaction',
      path: "m/44'/60'/0'/0/0",
      message: 'Sign Ethereum transaction',
      rawPayload: eip1559EthTx(),
    });
    expect(ok.style).toBe('eth-tx');
    expect(ok.decodeFailed).toBeUndefined();
    expect(ok.fields.some((field) => field.label === 'TO')).toBe(true);

    const bad = describeSigning({
      brand: 'ledger',
      kind: 'sign',
      title: 'Sign Ethereum transaction',
      path: "m/44'/60'/0'/0/0",
      message: 'Sign Ethereum transaction',
      rawPayload: garbageEthTx(),
    });
    expect(bad.decodeFailed).toBe(true);
    expect(bad.fields.find((field) => field.label === 'TO')).toBeUndefined();
  });

  it('does not invent an address on export requests', () => {
    const detail = describeSigning({
      brand: 'ledger',
      kind: 'address',
      title: 'Export Ethereum address',
      path: "m/44'/60'/0'/0/0",
      message: "Export Ethereum address\nm/44'/60'/0'/0/0",
      rawPayload: encodePath([hardened(44), hardened(60), hardened(0), 0, 0]),
    });
    expect(detail.style).toBe('address');
    expect(detail.fields.some((field) => /0x[0-9a-f]{40}/i.test(field.value))).toBe(false);
  });

  it('wraps a 65-byte signature into a type-2 envelope', () => {
    const sig = new Uint8Array(65);
    sig[0] = 1;
    sig[32] = 0xab;
    sig[64] = 0xcd;
    const raw = eip1559Signed(sig);
    expect(raw[0]).toBe(0x02);
    expect(parseEthTx(raw)?.type).toBe('eip1559');
    expect(bytesToHex(raw).includes('ab')).toBe(true);
  });
});
