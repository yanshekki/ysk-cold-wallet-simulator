import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import type { ChainPathMap, LedgerInstalledApp } from '@cws/contracts';
import { resetLedgerCatalogOverlay, setLedgerCatalogOverlay, type SeedSlot } from '@cws/contracts';
import { isAppLanguage, type AppLanguage } from '../i18n';

const SETTINGS_KEY = 'cws.settings.v1';
const ACTIVE_KEY = 'cws.activeSlot';
const CATALOG_KEY = 'cws.ledger.catalog';

export type AppSettings = {
  language: AppLanguage;
  nearAutoSponsor: boolean;
  logCap: number;
  confirmClearLogs: boolean;
  bleNameSuffix: string;
  faceIdEnabled: boolean;
  signReauth: boolean;
  autoLockMinutes: number;
  catalogUpdatedAt: number | null;
  defaultPaths: ChainPathMap;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  nearAutoSponsor: false,
  logCap: 1000,
  confirmClearLogs: true,
  bleNameSuffix: '',
  faceIdEnabled: true,
  signReauth: false,
  autoLockMinutes: 15,
  catalogUpdatedAt: null,
  defaultPaths: {},
};

function webGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  globalThis.localStorage?.setItem(key, value);
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webGet(key);
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export function detectLanguage(): AppLanguage {
  try {
    const locale = Localization.getLocales()[0];
    const code = locale?.languageCode ?? '';
    const tag = locale?.languageTag ?? '';
    if (/^zh/i.test(code) || /^zh/i.test(tag)) {
      return 'zh-HK';
    }
    if (/^pt/i.test(code) || /^pt/i.test(tag)) {
      return 'pt';
    }
    if (isAppLanguage(code)) {
      return code;
    }
  } catch {
    // native module may be missing until rebuild
  }
  return 'en';
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await readRaw(SETTINGS_KEY);
  const detected = detectLanguage();
  if (!raw) {
    return { ...DEFAULT_SETTINGS, language: detected };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const storedLang = parsed.language ?? '';
    const language = isAppLanguage(storedLang) ? storedLang : detected;
    return { ...DEFAULT_SETTINGS, ...parsed, language };
  } catch {
    return { ...DEFAULT_SETTINGS, language: detected };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeRaw(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadActiveSlotId(): Promise<string | null> {
  return readRaw(ACTIVE_KEY);
}

export async function saveActiveSlotId(id: string | null): Promise<void> {
  if (!id) {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(ACTIVE_KEY);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(ACTIVE_KEY);
    } catch {
      // ignore
    }
    return;
  }
  await writeRaw(ACTIVE_KEY, id);
}

export async function loadCatalogOverlay(): Promise<LedgerInstalledApp[] | undefined> {
  const raw = await readRaw(CATALOG_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as LedgerInstalledApp[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }
    setLedgerCatalogOverlay(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export async function saveCatalogOverlay(apps: LedgerInstalledApp[]): Promise<void> {
  setLedgerCatalogOverlay(apps);
  await writeRaw(CATALOG_KEY, JSON.stringify(apps));
}

export async function clearCatalogOverlay(): Promise<void> {
  resetLedgerCatalogOverlay();
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.removeItem(CATALOG_KEY);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(CATALOG_KEY);
  } catch {
    // ignore
  }
}

export function resolveDefaultSlot(slots: SeedSlot[], activeId: string | null): SeedSlot | null {
  if (activeId) {
    return slots.find((slot) => slot.id === activeId) ?? slots[0] ?? null;
  }
  return slots[0] ?? null;
}
