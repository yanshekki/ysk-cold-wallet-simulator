import { applyVersionCatalog, fromManagerRow, ledgerOsFor, type LedgerInstalledApp } from '@cws/contracts';
import { scanApplicationVersions } from './ledgerCatalogScan';

const TARGET_IDS: Record<string, number> = {
  'nano-x': 0x33000004,
  stax: 0x33200004,
  flex: 0x33300004,
  gen5: 0x33400004,
};

export function managerCatalogUrl(modelId: string): string {
  const target = TARGET_IDS[modelId] ?? TARGET_IDS['nano-x'];
  const firmware = ledgerOsFor(modelId).se;
  const params = new URLSearchParams({
    provider: '1',
    target_id: String(target >>> 0),
    firmware_version_name: firmware,
  });
  return `https://manager.api.live.ledger.com/api/v2/apps/by-target?${params.toString()}`;
}

/** Device-version row for a target id. `id` selects that device's app builds. */
export function deviceVersionUrl(modelId: string): string {
  const target = TARGET_IDS[modelId] ?? TARGET_IDS['nano-x'];
  const params = new URLSearchParams({
    provider: '1',
    target_id: String(target >>> 0),
  });
  return `https://manager.api.live.ledger.com/api/get_device_version?${params.toString()}`;
}

/** Every published application version. Filtered per device while scanning. */
export function applicationsCatalogUrl(): string {
  return 'https://manager.api.live.ledger.com/api/applications?provider=1';
}

export function parseDeviceVersionId(payload: unknown): number {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Manager device version was empty');
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new Error('Manager device version was empty');
  }
  return id;
}

type ManagerRow = {
  versionName?: string;
  versionDisplayName?: string;
  version?: string;
  applicationType?: string | null;
  isDevTools?: boolean;
};

export function parseManagerApps(payload: unknown): LedgerInstalledApp[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const seen = new Set<string>();
  const apps: LedgerInstalledApp[] = [];
  for (const item of payload as ManagerRow[]) {
    if (item.isDevTools) {
      continue;
    }
    const name = (item.versionName ?? item.versionDisplayName ?? '').trim();
    const version = (item.version ?? '').trim();
    if (!name || !version) {
      continue;
    }
    const row = fromManagerRow(name, version);
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    apps.push(row);
  }
  return apps;
}

async function readJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

export async function fetchManagerCatalog(modelId: string): Promise<LedgerInstalledApp[]> {
  const [latestResponse, deviceResponse, versionsResponse] = await Promise.all([
    fetch(managerCatalogUrl(modelId)),
    fetch(deviceVersionUrl(modelId)),
    fetch(applicationsCatalogUrl()),
  ]);
  const latestPayload = await readJson(latestResponse, 'Manager catalog');
  const devicePayload = await readJson(deviceResponse, 'Manager device version');
  if (!versionsResponse.ok) {
    throw new Error(`Manager app versions HTTP ${versionsResponse.status}`);
  }
  const versionsText = await versionsResponse.text();
  const latest = parseManagerApps(latestPayload);
  if (latest.length === 0) {
    throw new Error('Manager catalog was empty');
  }
  const versionsById = scanApplicationVersions(versionsText, parseDeviceVersionId(devicePayload), 1);
  if (Object.keys(versionsById).length === 0) {
    throw new Error('Manager app versions were empty');
  }
  return applyVersionCatalog(latest, versionsById);
}
