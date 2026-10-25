import { describe, expect, it } from 'vitest';
import { entropyKey, secureStoreKey, sharesKey, SLOTS_KEY } from './vaultKeys';

const SECURE_STORE_KEY = /^[A-Za-z0-9._-]+$/;

describe('secureStoreKey', () => {
  it('uses only characters expo-secure-store allows', () => {
    expect(SLOTS_KEY).toBe('cws.slots');
    expect(SLOTS_KEY).toMatch(SECURE_STORE_KEY);
  });

  it('strips colons and other illegal characters from slot ids', () => {
    const key = entropyKey('cws:legacy/id');
    expect(key).toBe('cws.entropy.cws_legacy_id');
    expect(key).toMatch(SECURE_STORE_KEY);
  });

  it('keeps UUID hyphens', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(entropyKey(id)).toBe(`cws.entropy.${id}`);
    expect(entropyKey(id)).toMatch(SECURE_STORE_KEY);
    expect(sharesKey(id)).toBe(`cws.shares.${id}`);
    expect(sharesKey(id)).toMatch(SECURE_STORE_KEY);
  });

  it('rejects empty parts', () => {
    expect(() => secureStoreKey('   ')).toThrow(/empty/);
  });
});
