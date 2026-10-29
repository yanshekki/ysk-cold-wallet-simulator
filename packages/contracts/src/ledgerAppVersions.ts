import versionIndex from './ledgerVersionIndex.json';
import type { LedgerInstalledApp } from './ledgerApps';

/**
 * Published Ledger app versions per device, provider 1.
 * Snapshot 29 Oct 2026 of
 * https://manager.api.live.ledger.com/api/applications?provider=1
 * Device version ids: Nano X 9, Stax 17, Flex 135, Nano G5 (Apex P) 136.
 * Only MAJOR.MINOR.PATCH with each component in 0..255. Cardano 7.0.0 is
 * Ledger's club provider (3) and is not in this default catalog.
 */
const LEDGER_VERSION_INDEX = versionIndex as Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

export type StoredLedgerCatalog = {
  modelId: string | null;
  apps: LedgerInstalledApp[];
};

/** True when GET_VERSION's three bytes can carry this version unchanged. */
export function isReportableLedgerVersion(version: string): boolean {
  if (!STABLE_VERSION.test(version)) {
    return false;
  }
  const parts = version.split('.');
  if (parts.length !== 3) {
    return false;
  }
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return false;
    }
  }
  return true;
}

function compareLedgerVersion(a: string, b: string): number {
  const av = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bv = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Unique reportable versions, oldest first. */
export function stableVersionList(versions: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const version of versions) {
    const trimmed = version.trim();
    if (isReportableLedgerVersion(trimmed)) {
      unique.add(trimmed);
    }
  }
  return [...unique].sort(compareLedgerVersion);
}

export function bundledLedgerVersions(modelId: string, appId: string): readonly string[] {
  const model = LEDGER_VERSION_INDEX[modelId] ?? LEDGER_VERSION_INDEX['nano-x'];
  return model?.[appId] ?? [];
}

function withReported(versions: readonly string[], reported: string): readonly string[] {
  const stable = stableVersionList(versions);
  if (stable.includes(reported)) {
    return stable;
  }
  return reported ? [...stable, reported] : stable;
}

/**
 * Versions the picker may offer.
 * A saved list is used only when it was synced for `modelId`.
 * Otherwise the bundled list for that device is the offline fallback.
 * The app's current version stays selectable even when it is not in the list.
 */
export function versionsForApp(
  app: LedgerInstalledApp,
  modelId: string,
  savedModelId: string | null,
): readonly string[] {
  const saved =
    savedModelId === modelId && app.availableVersions && app.availableVersions.length > 0
      ? app.availableVersions
      : undefined;
  const listed = saved ?? bundledLedgerVersions(modelId, app.id);
  return withReported(listed, app.version);
}

/** Attach a synced version list. `version` stays the by-target default, not the newest publish. */
export function applyVersionCatalog(
  latest: readonly LedgerInstalledApp[],
  versionsById: Readonly<Record<string, readonly string[]>>,
): LedgerInstalledApp[] {
  return latest.map((app) => {
    const availableVersions = stableVersionList([...(versionsById[app.id] ?? []), app.version]);
    const reported = availableVersions.includes(app.version) ? availableVersions : [...availableVersions, app.version];
    return {
      ...app,
      availableVersions: reported,
    };
  });
}

/** Drop picks the refreshed catalog no longer lists. */
export function keepVersionPicks(
  picks: Readonly<Record<string, string>>,
  fresh: readonly LedgerInstalledApp[],
  modelId: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const app of fresh) {
    const picked = picks[app.id];
    if (!picked || picked === app.version) {
      continue;
    }
    const choices = versionsForApp(app, modelId, modelId);
    if (choices.includes(picked)) {
      next[app.id] = picked;
    }
  }
  return next;
}

/**
 * Next pick map. `apps` is the base catalog (snapshot or last Update), not the
 * reported view. Choosing the base version clears the pick.
 * Returns undefined when the version is not offered for this device.
 */
export function nextVersionPicks(
  picks: Readonly<Record<string, string>>,
  apps: readonly LedgerInstalledApp[],
  id: string,
  version: string,
  modelId: string,
  savedModelId: string | null,
): Record<string, string> | undefined {
  const base = apps.find((app) => app.id === id);
  if (!base) {
    return undefined;
  }
  const choices = versionsForApp(base, modelId, savedModelId);
  if (!choices.includes(version)) {
    return undefined;
  }
  const next = { ...picks };
  if (version === base.version) {
    delete next[id];
  } else {
    next[id] = version;
  }
  return next;
}

export function sameVersionPicks(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every((key) => a[key] === b[key]);
}

function sanitizeApp(value: unknown): LedgerInstalledApp | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const app = value as Partial<LedgerInstalledApp>;
  if (
    typeof app.id !== 'string' ||
    typeof app.openAppName !== 'string' ||
    typeof app.version !== 'string' ||
    typeof app.chip !== 'string' ||
    typeof app.family !== 'string'
  ) {
    return undefined;
  }
  const available = Array.isArray(app.availableVersions)
    ? app.availableVersions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
  return {
    id: app.id,
    openAppName: app.openAppName,
    version: app.version,
    chip: app.chip,
    family: app.family,
    ...(available && available.length > 0 ? { availableVersions: available } : {}),
  };
}

function sanitizeApps(value: unknown): LedgerInstalledApp[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(sanitizeApp).filter((app): app is LedgerInstalledApp => app !== undefined);
}

/** Accept the legacy app array and `{ modelId, apps }` from Update. */
export function parseStoredCatalog(payload: unknown): StoredLedgerCatalog | undefined {
  if (Array.isArray(payload)) {
    const apps = sanitizeApps(payload);
    return apps.length > 0 ? { modelId: null, apps } : undefined;
  }
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as { modelId?: unknown; apps?: unknown };
  const apps = sanitizeApps(record.apps);
  if (apps.length === 0) {
    return undefined;
  }
  const modelId = typeof record.modelId === 'string' && record.modelId.trim() ? record.modelId.trim() : null;
  return { modelId, apps };
}

export function parseVersionPicks(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const picks: Record<string, string> = {};
  for (const [id, version] of Object.entries(payload)) {
    if (typeof id !== 'string' || !id.trim()) {
      continue;
    }
    if (typeof version !== 'string' || !/^[0-9.]{1,32}$/.test(version)) {
      continue;
    }
    picks[id] = version;
  }
  return picks;
}
