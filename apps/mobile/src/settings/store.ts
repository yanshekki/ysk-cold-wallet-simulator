import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import type { ChainPathMap, LedgerInstalledApp } from '@cws/contracts';
import {
  HOLD_CONFIRM_DEFAULT_SECONDS,
  clampHoldDuration,
  resetLedgerCatalogOverlay,
  setLedgerCatalogOverlay,
  type SeedSlot,
} from '@cws/contracts';
import { isAppLanguage, type AppLanguage } from '../i18n/translate';

const SETTINGS_KEY = 'cws.settings.v1';
const ACTIVE_KEY = 'cws.activeSlot';
const CATALOG_KEY = 'cws.ledger.catalog';
const CATALOG_CHUNK = 1800;

export type AppSettings = {
  language: AppLanguage;
  nearAutoSponsor: boolean;
  logCap: number;
  confirmClearLogs: boolean;
  bleNameSuffix: string;
  faceIdEnabled: boolean;
  signReauth: boolean;
  autoLockMinutes: number;
  holdDurationSeconds: number;
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
  signReauth: true,
  autoLockMinutes: 15,
  holdDurationSeconds: HOLD_CONFIRM_DEFAULT_SECONDS,
  catalogUpdatedAt: null,
  defaultPaths: {},
};

export function normalizeSettings(
  parsed: Partial<AppSettings>,
  fallbackLanguage: AppLanguage,
): AppSettings {
  const storedLang = parsed.language ?? '';
  const language = isAppLanguage(storedLang) ? storedLang : fallbackLanguage;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    language,
    holdDurationSeconds: clampHoldDuration(
      parsed.holdDurationSeconds ?? DEFAULT_SETTINGS.holdDurationSeconds,
    ),
  };
}

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
    return normalizeSettings({}, detected);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return normalizeSettings(parsed, detected);
  } catch {
    return normalizeSettings({}, detected);
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

async function deleteRaw(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export async function loadCatalogOverlay(): Promise<LedgerInstalledApp[] | undefined> {
  const countRaw = await readRaw(`${CATALOG_KEY}.n`);
  let raw: string | null = null;
  if (countRaw) {
    const count = Number.parseInt(countRaw, 10);
    if (Number.isFinite(count) && count > 0) {
      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        parts.push((await readRaw(`${CATALOG_KEY}.${i}`)) ?? '');
      }
      raw = parts.join('');
    }
  }
  raw ??= await readRaw(CATALOG_KEY);
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
  const raw = JSON.stringify(apps);
  if (Platform.OS === 'web') {
    webSet(CATALOG_KEY, raw);
    return;
  }
  const chunks = Math.max(1, Math.ceil(raw.length / CATALOG_CHUNK));
  await writeRaw(`${CATALOG_KEY}.n`, String(chunks));
  for (let i = 0; i < chunks; i += 1) {
    await writeRaw(`${CATALOG_KEY}.${i}`, raw.slice(i * CATALOG_CHUNK, (i + 1) * CATALOG_CHUNK));
  }
  await deleteRaw(CATALOG_KEY);
}

export async function clearCatalogOverlay(): Promise<void> {
  resetLedgerCatalogOverlay();
  const countRaw = await readRaw(`${CATALOG_KEY}.n`);
  const count = Number.parseInt(countRaw ?? '0', 10);
  await deleteRaw(CATALOG_KEY);
  await deleteRaw(`${CATALOG_KEY}.n`);
  const n = Number.isFinite(count) ? count : 0;
  for (let i = 0; i < Math.max(n, 16); i += 1) {
    await deleteRaw(`${CATALOG_KEY}.${i}`);
  }
}

export function resolveDefaultSlot(slots: SeedSlot[], activeId: string | null): SeedSlot | null {
  if (activeId) {
    return slots.find((slot) => slot.id === activeId) ?? slots[0] ?? null;
  }
  return slots[0] ?? null;
}
