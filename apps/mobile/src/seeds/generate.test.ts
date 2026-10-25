import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entropyFromMnemonic, mnemonicFromEntropy } from '@cws/sdk';

const getRandomBytesAsync = vi.fn();

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: (bytes: number) => getRandomBytesAsync(bytes),
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
}));

const FOUNDRY = 'test test test test test test test test test test test junk';

describe('generateSecureMnemonic', () => {
  beforeEach(() => {
    getRandomBytesAsync.mockReset();
  });

  it('uses expo-crypto entropy and never Math.random', async () => {
    const entropy = new Uint8Array(16).map((_, i) => i + 3);
    getRandomBytesAsync.mockResolvedValue(entropy);
    const randomSpy = vi.spyOn(Math, 'random');
    const { generateSecureMnemonic } = await import('./generate');
    const mnemonic = await generateSecureMnemonic(12);
    expect(getRandomBytesAsync).toHaveBeenCalledWith(16);
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(mnemonic).not.toBe(FOUNDRY);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('never returns the Foundry lab mnemonic', async () => {
    getRandomBytesAsync.mockResolvedValue(entropyFromMnemonic(FOUNDRY));
    const { generateSecureMnemonic } = await import('./generate');
    await expect(generateSecureMnemonic(12)).rejects.toThrow(/well-known test mnemonic/);
    expect(mnemonicFromEntropy(entropyFromMnemonic(FOUNDRY))).toBe(FOUNDRY);
  });
});
