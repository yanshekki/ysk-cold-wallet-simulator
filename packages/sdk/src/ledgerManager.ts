import { fromManagerRow, ledgerOsFor, type LedgerInstalledApp } from '@cws/contracts';

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

export async function fetchManagerCatalog(modelId: string): Promise<LedgerInstalledApp[]> {
  const response = await fetch(managerCatalogUrl(modelId));
  if (!response.ok) {
    throw new Error(`Manager catalog HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  const apps = parseManagerApps(payload);
  if (apps.length === 0) {
    throw new Error('Manager catalog was empty');
  }
  return apps;
}
