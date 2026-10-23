import { describe, expect, it } from 'vitest';
import { toBip32Seed } from './seed';
import { combineSlip39, generateSlip39, isSlip39Mnemonic } from './slip39';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('SLIP-39', () => {
  it('round-trips a 16-byte master secret through a single 20-word share', () => {
    const secret = new Uint8Array(16).map((_, i) => i + 1);
    const backup = generateSlip39(secret, { threshold: 1, count: 1 });
    expect(backup.shares).toHaveLength(1);
    expect(backup.shares[0].split(' ')).toHaveLength(20);
    expect(isSlip39Mnemonic(backup.shares[0])).toBe(true);
    expect(Array.from(combineSlip39(backup.shares))).toEqual(Array.from(secret));
  });

  it('recovers a 2-of-3 Basic set from any two shares', () => {
    const secret = new Uint8Array(16).map((_, i) => (i * 9) % 251);
    const backup = generateSlip39(secret, { threshold: 2, count: 3 });
    expect(backup.shares).toHaveLength(3);
    expect(Array.from(combineSlip39([backup.shares[0], backup.shares[1]]))).toEqual(Array.from(secret));
    expect(Array.from(combineSlip39([backup.shares[1], backup.shares[2]]))).toEqual(Array.from(secret));
    expect(Array.from(combineSlip39([backup.shares[0], backup.shares[2]]))).toEqual(Array.from(secret));
  });

  it('recovers the SatoshiLabs 1-of-1 vector with passphrase TREZOR', () => {
    const secret = combineSlip39(
      [
        'duckling enlarge academic academic agency result length solution fridge kidney coal piece deal husband erode duke ajar critical decision keyboard',
      ],
      'TREZOR',
    );
    expect(hex(secret)).toBe('bb54aac4b89dc868ba37d9cc21b2cece');
  });

  it('recovers the SatoshiLabs 2-of-3 vector with passphrase TREZOR', () => {
    const secret = combineSlip39(
      [
        'shadow pistol academic always adequate wildlife fancy gross oasis cylinder mustang wrist rescue view short owner flip making coding armed',
        'shadow pistol academic acid actress prayer class unknown daughter sweater depict flip twice unkind craft early superior advocate guest smoking',
      ],
      'TREZOR',
    );
    expect(hex(secret)).toBe('b43ceb7e57a0ea8766221624d01b0864');
  });

  it('uses the master secret as BIP32 seed without BIP39 stretching', () => {
    const secret = new Uint8Array(16).map((_, i) => i + 1);
    expect(toBip32Seed(secret, 'slip39')).toBe(secret);
  });
});
