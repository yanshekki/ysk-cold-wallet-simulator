import { describe, expect, it, vi } from 'vitest';
import type { SeedSlot } from '@cws/contracts';
import { ensureNearAccount, nearKeysFromSeed } from './service';

const seed = new Uint8Array(64).fill(1);

const slot: SeedSlot = {
  id: 'slot-1',
  label: 'test',
  brand: 'ledger',
  modelId: 'nano-x',
  wordCount: 24,
  createdAt: 1,
};

describe('NEAR local derive', () => {
  it('derives keys without fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const keys = nearKeysFromSeed(seed);
    expect(keys.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.publicKey.startsWith('ed25519:')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not claim on-chain existence or sponsorship', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const status = ensureNearAccount(seed, slot);
    expect(status.exists).toBe(false);
    expect(status.created).toBe(false);
    expect(status.accountId).toBe(nearKeysFromSeed(seed).accountId);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
