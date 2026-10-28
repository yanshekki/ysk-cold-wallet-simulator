import { beforeEach, describe, expect, it, vi } from 'vitest';

const setStringAsync = vi.fn(async (_value: string) => true);

vi.mock('expo-clipboard', () => ({
  setStringAsync: (value: string) => setStringAsync(value),
  getStringAsync: async () => '',
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Share: { share: vi.fn() },
}));

import { copyText } from './copy';

describe('copyText', () => {
  beforeEach(() => {
    setStringAsync.mockClear();
  });

  it('does not write recovery material', async () => {
    await expect(copyText('secret material', 'secret')).resolves.toBe(false);
    expect(setStringAsync).not.toHaveBeenCalled();
  });

  it('writes public text', async () => {
    await expect(copyText('bc1qexample', 'public')).resolves.toBe(true);
    expect(setStringAsync).toHaveBeenCalledWith('bc1qexample');
  });
});
