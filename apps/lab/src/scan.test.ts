import { describe, expect, it } from 'vitest';
import {
  bluetoothBlockReason,
  shouldWidenScan,
  walletNameFilters,
  walletRequestOptions,
  walletServiceUuids,
} from './scan';

describe('wallet scan filters', () => {
  it('uses advertised names, not service UUIDs, so iOS packets still match', () => {
    const ledger = walletNameFilters('ledger');
    expect(ledger.some((item) => item.namePrefix === 'Nano X')).toBe(true);
    expect(ledger.some((item) => item.namePrefix === 'Flex')).toBe(true);
    expect(ledger.every((item) => item.namePrefix.length >= 2)).toBe(true);
    expect(walletServiceUuids('ledger')).toContain('13d63400-2c97-0004-0000-4c6564676572');
  });

  it('keeps OneKey serial-style names without 1-character prefixes', () => {
    const names = walletNameFilters('onekey').map((item) => item.namePrefix);
    expect(names).toContain('K1234');
    expect(names).toContain('1S A1B2');
    expect(names).toContain('Pro');
    expect(names.every((name) => name.length >= 2)).toBe(true);
  });

  it('puts GATT UUIDs in optionalServices so name-only advertisements can still connect', () => {
    const named = walletRequestOptions('trezor', false);
    const all = walletRequestOptions('trezor', true);
    expect(named.filters?.some((item) => item.namePrefix.startsWith('Trezor'))).toBe(true);
    expect(named.acceptAllDevices).toBeUndefined();
    expect(all.acceptAllDevices).toBe(true);
    expect(all.filters).toBeUndefined();
    expect(all.optionalServices).toEqual(named.optionalServices);
    expect(all.optionalServices).toContain('8c000001-a59b-4d58-a9ad-073df69fa1b1');
  });
});

describe('shouldWidenScan', () => {
  it('retries empty scans but not a cancelled chooser', () => {
    expect(shouldWidenScan(Object.assign(new Error('No Bluetooth devices found'), { name: 'NotFoundError' }))).toBe(
      true,
    );
    expect(shouldWidenScan(Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }))).toBe(
      false,
    );
  });
});

describe('bluetoothBlockReason', () => {
  it('explains Brave’s default-off flag and insecure LAN origins', () => {
    expect(bluetoothBlockReason({ bluetooth: false, secureContext: true, brave: true })).toBe(
      'Brave Web Bluetooth disabled',
    );
    expect(bluetoothBlockReason({ bluetooth: true, secureContext: false, brave: false })).toBe('Insecure origin');
    expect(bluetoothBlockReason({ bluetooth: true, secureContext: true, brave: true })).toBeNull();
  });
});
