import { describe, expect, it } from 'vitest';
import { hashTypedData } from './eip712';

const MAIL = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: {
      name: 'Cow',
      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    },
    to: {
      name: 'Bob',
      wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    },
    contents: 'Hello, Bob!',
  },
};

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('hashTypedData', () => {
  it('matches the EIP-712 Ether Mail digest', () => {
    expect(toHex(hashTypedData(MAIL))).toBe(
      'be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
    );
    expect(toHex(hashTypedData(new TextEncoder().encode(JSON.stringify(MAIL))))).toBe(
      'be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
    );
  });
});
