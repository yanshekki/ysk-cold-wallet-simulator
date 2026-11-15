import { describe, expect, it } from 'vitest';
import { concatBytes } from '../bytes';
import {
  BYRON_ADDRESS_MAX_DISPLAYABLE_SIZE,
  isCip36PaymentAddressAllowed,
  isThirdPartyOutputAddressAllowed,
  isValidShelleyAddressLength,
} from './cardanoAddress';

function enterprise(extra = 0): Uint8Array {
  return concatBytes(Uint8Array.of(0x61), new Uint8Array(28 + extra).fill(0x22));
}

function baseKeyKey(): Uint8Array {
  return concatBytes(Uint8Array.of(0x01), new Uint8Array(56).fill(0x33));
}

describe('Cardano 8.0.11 host-address length (LedgerHQ/app-cardano cbb0bb0)', () => {
  it('accepts exact Shelley enterprise and base lengths', () => {
    expect(isValidShelleyAddressLength(6, 29)).toBe(true);
    expect(isValidShelleyAddressLength(0, 57)).toBe(true);
    expect(isValidShelleyAddressLength(4, 32)).toBe(true);
    expect(isValidShelleyAddressLength(4, 40)).toBe(true);
    expect(isValidShelleyAddressLength(4, 31)).toBe(false);
    expect(isValidShelleyAddressLength(4, 41)).toBe(false);
    expect(isThirdPartyOutputAddressAllowed(enterprise())).toBe(true);
    expect(isThirdPartyOutputAddressAllowed(baseKeyKey())).toBe(true);
    expect(isCip36PaymentAddressAllowed(enterprise())).toBe(true);
  });

  it('rejects a wrong-length Shelley output that 8.0.11 would deny', () => {
    expect(isThirdPartyOutputAddressAllowed(enterprise(1))).toBe(false);
    expect(isCip36PaymentAddressAllowed(enterprise(1))).toBe(false);
  });

  it('rejects Byron outputs longer than 108 bytes and Byron CIP-36 payments', () => {
    const byronOk = concatBytes(Uint8Array.of(0x82), new Uint8Array(107).fill(0x11));
    const byronOver = concatBytes(Uint8Array.of(0x82), new Uint8Array(108).fill(0x11));
    expect(byronOk.length).toBe(BYRON_ADDRESS_MAX_DISPLAYABLE_SIZE);
    expect(isThirdPartyOutputAddressAllowed(byronOk)).toBe(true);
    expect(isThirdPartyOutputAddressAllowed(byronOver)).toBe(false);
    expect(isCip36PaymentAddressAllowed(byronOk)).toBe(false);
  });

  it('rejects empty and unsupported address types', () => {
    expect(isThirdPartyOutputAddressAllowed(new Uint8Array())).toBe(false);
    expect(isThirdPartyOutputAddressAllowed(Uint8Array.of(0x91, ...new Uint8Array(28)))).toBe(false);
  });
});
