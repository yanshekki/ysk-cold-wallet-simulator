import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import type { ChainPathMap, LedgerInstalledApp } from '@cws/contracts';
import {
  HOLD_CONFIRM_DEFAULT_SECONDS,
  clampHoldDuration,
  ledgerVersionPicks,
  parseBlePeripheralId,
  parseStoredCatalog,
  parseVersionPicks,
  resetLedgerCatalogOverlay,
  resetLedgerVersionPicks,
  setLedgerCatalogOverlay,
  setLedgerVersionPicks,
  type SeedSlot,
} from '@cws/contracts';
import { isAppLanguage, type AppLanguage } from '../i18n/translate';

const SETTINGS_KEY = 'cws.settings.v1';
const ACTIVE_KEY = 'cws.activeSlot';
const CATALOG_KEY = 'cws.ledger.catalog';
const VERSION_PICKS_KEY = 'cws.ledger.versions';
const CATALOG_CHUNK = 1800;

export type AppSettings = {
  language: AppLanguage;
  nearAutoSponsor: boolean;
  logCap: number;
  confirmClearLogs: boolean;
  bleNameSuffix: string;
  /** Four digits spliced into OneKey GAP names so two phones are not identical. */
  bleIdentityToken: string;
  /** Host Bluetooth id CWS Proxy uses to lock this phone. Empty until the proxy writes it. */
  blePeripheralId: string;
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
  bleIdentityToken: '',
  blePeripheralId: '',
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
  const token = parsed.bleIdentityToken ?? '';
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    language,
    bleIdentityToken: /^\d{4}$/.test(token) ? token : '',
    blePeripheralId: parseBlePeripheralId(parsed.blePeripheralId ?? '') ?? '',
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

export async function loadCatalogOverlay(): Promise<
  { modelId: string | null; apps: LedgerInstalledApp[] } | undefined
> {
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
    const stored = parseStoredCatalog(JSON.parse(raw) as unknown);
    if (!stored) {
      return undefined;
    }
    setLedgerCatalogOverlay(stored.apps, stored.modelId);
    return stored;
  } catch {
    return undefined;
  }
}

export async function saveCatalogOverlay(apps: LedgerInstalledApp[], modelId: string | null): Promise<void> {
  setLedgerCatalogOverlay(apps, modelId);
  const raw = JSON.stringify({ modelId, apps });
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

export async function loadVersionPicks(): Promise<Record<string, string>> {
  const raw = await readRaw(VERSION_PICKS_KEY);
  if (!raw) {
    resetLedgerVersionPicks();
    return {};
  }
  try {
    const picks = parseVersionPicks(JSON.parse(raw) as unknown);
    setLedgerVersionPicks(picks);
    return picks;
  } catch {
    resetLedgerVersionPicks();
    return {};
  }
}

export async function saveVersionPicks(picks: Record<string, string>): Promise<void> {
  const previous = { ...ledgerVersionPicks() };
  setLedgerVersionPicks(picks);
  try {
    if (Object.keys(picks).length === 0) {
      await deleteRaw(VERSION_PICKS_KEY);
      return;
    }
    await writeRaw(VERSION_PICKS_KEY, JSON.stringify(picks));
  } catch (error) {
    setLedgerVersionPicks(previous);
    throw error;
  }
}

export async function clearVersionPicks(): Promise<void> {
  resetLedgerVersionPicks();
  await deleteRaw(VERSION_PICKS_KEY);
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
