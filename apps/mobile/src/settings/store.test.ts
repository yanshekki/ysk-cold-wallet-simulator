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
    expect(normalizeSettings({ holdDurationSeconds: 0 }, 'en').holdDurationSeconds).toBe(3);
    expect(normalizeSettings({ holdDurationSeconds: 1 }, 'en').holdDurationSeconds).toBe(3);
    expect(DEFAULT_SETTINGS.signReauth).toBe(true);

    getItemAsync.mockResolvedValueOnce(JSON.stringify({ language: 'en', autoLockMinutes: 15 }));
    const loaded = await loadSettings();
    expect(loaded.holdDurationSeconds).toBe(3);
  });

  it('round-trips a synced catalog and a version pick on web', async () => {
    platform.OS = 'web';
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    const { clearCatalogOverlay, clearVersionPicks, loadCatalogOverlay, loadVersionPicks, saveCatalogOverlay, saveVersionPicks } =
      await import('./store');
    const cardano = {
      id: 'cardano',
      openAppName: 'Cardano ADA',
      version: '8.0.8',
      chip: 'ADA',
      family: 'cardano' as const,
      availableVersions: ['7.2.1', '8.0.8'],
    };
    await saveCatalogOverlay([cardano], 'nano-x');
    await saveVersionPicks({ cardano: '7.2.1' });
    const loaded = await loadCatalogOverlay();
    const picks = await loadVersionPicks();
    expect(loaded?.modelId).toBe('nano-x');
    expect(loaded?.apps[0]?.availableVersions).toEqual(['7.2.1', '8.0.8']);
    expect(picks).toEqual({ cardano: '7.2.1' });
    await clearVersionPicks();
    await clearCatalogOverlay();
    vi.unstubAllGlobals();
  });
});
