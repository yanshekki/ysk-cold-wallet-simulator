import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedSlot } from '@cws/contracts';

const platform = { OS: 'ios' };
const setItemAsync = vi.fn();
const getItemAsync = vi.fn();
const deleteItemAsync = vi.fn();

vi.mock('react-native', () => ({
  Platform: platform,
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: (...args: unknown[]) => setItemAsync(...args),
  getItemAsync: (...args: unknown[]) => getItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => deleteItemAsync(...args),
}));

vi.mock('../passkeys/devFlag', () => ({
  isDevBuild: () => false,
}));

const SLOT: SeedSlot = {
  id: '00000000-0000-4000-8000-000000000000',
  label: 'test',
  brand: 'ledger',
  modelId: 'nano-x',
  wordCount: 12,
  createdAt: 1,
};

describe('vault SecureStore options', () => {
  beforeEach(() => {
    platform.OS = 'ios';
    setItemAsync.mockReset();
    getItemAsync.mockReset();
    deleteItemAsync.mockReset();
    setItemAsync.mockResolvedValue(undefined);
    getItemAsync.mockResolvedValue(null);
    deleteItemAsync.mockResolvedValue(undefined);
  });

  it('stores entropy with requireAuthentication in a release build', async () => {
    const { saveSlot, entropyKey, loadEntropy, lockVaultMemory } = await import('./vault');
    lockVaultMemory();
    await saveSlot(SLOT, new Uint8Array(16));
    const entropyCall = setItemAsync.mock.calls.find((call) => call[0] === entropyKey(SLOT.id));
    expect(entropyCall?.[2]).toMatchObject({
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      requireAuthentication: true,
    });
    lockVaultMemory();
    getItemAsync.mockClear();
    getItemAsync.mockResolvedValue('AAAAAAAAAAAAAAAAAAAAAA==');
    await loadEntropy(SLOT.id);
    await loadEntropy(SLOT.id);
    expect(getItemAsync).toHaveBeenCalledTimes(1);
    expect(getItemAsync.mock.calls[0]?.[1]).toMatchObject({ requireAuthentication: true });
    await loadEntropy(SLOT.id, true);
    expect(getItemAsync).toHaveBeenCalledTimes(2);
  });

  it('refuses to write entropy on web', async () => {
    platform.OS = 'web';
    const { saveSlot } = await import('./vault');
    await expect(saveSlot(SLOT, new Uint8Array(16))).rejects.toThrow(/web vault refuses/);
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});
