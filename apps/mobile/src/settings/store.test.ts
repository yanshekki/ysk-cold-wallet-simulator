import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { OS: 'ios' };
const getItemAsync = vi.fn();

vi.mock('react-native', () => ({
  Platform: platform,
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => getItemAsync(...args),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));

describe('settings hold duration', () => {
  beforeEach(() => {
    platform.OS = 'ios';
    getItemAsync.mockReset();
    getItemAsync.mockResolvedValue(null);
  });

  it('defaults missing hold duration to 3 seconds and clamps stored values', async () => {
    const { DEFAULT_SETTINGS, loadSettings, normalizeSettings } = await import('./store');
    expect(DEFAULT_SETTINGS.holdDurationSeconds).toBe(3);
    expect(normalizeSettings({}, 'en').holdDurationSeconds).toBe(3);
    expect(normalizeSettings({ holdDurationSeconds: 99 }, 'zh-HK').holdDurationSeconds).toBe(10);
    expect(normalizeSettings({ holdDurationSeconds: 0 }, 'en').holdDurationSeconds).toBe(1);

    getItemAsync.mockResolvedValueOnce(JSON.stringify({ language: 'en', autoLockMinutes: 15 }));
    const loaded = await loadSettings();
    expect(loaded.holdDurationSeconds).toBe(3);
  });
});
