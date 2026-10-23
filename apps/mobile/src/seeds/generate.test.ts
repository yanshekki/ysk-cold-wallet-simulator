import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRandomBytesAsync = vi.fn();

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: (bytes: number) => getRandomBytesAsync(bytes),
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
}));

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
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
