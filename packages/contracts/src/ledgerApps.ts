import { LEDGER_MANAGER_SNAPSHOT } from './ledgerCatalog.snapshot';

export type LedgerInstalledAppId =
  | 'bitcoin'
  | 'ethereum'
  | 'avalanche'
  | 'solana'
  | 'xrp'
  | 'cardano'
  | 'polkadot'
  | 'tron'
  | 'cosmos'
  | 'near'
  | 'ton'
  | 'aptos'
  | 'sui'
  | 'dogecoin'
  | 'litecoin';

export type LedgerAppFamily =
  | 'bitcoin'
  | 'ethereum'
  | 'avalanche'
  | 'solana'
  | 'xrp'
  | 'cardano'
  | 'polkadot'
  | 'tron'
  | 'cosmos'
  | 'near'
  | 'ton'
  | 'aptos'
  | 'sui'
  | 'stellar'
  | 'unknown';

export type LedgerApp = 'dashboard' | string;

export type LedgerInstalledApp = {
  id: string;
  openAppName: string;
  version: string;
  chip: string;
  family: LedgerAppFamily;
};

const FAMILY_RULES: [RegExp, LedgerAppFamily][] = [
  [/^bitcoin/i, 'bitcoin'],
  [/litecoin/i, 'bitcoin'],
  [/dogecoin/i, 'bitcoin'],
  [/ethereum/i, 'ethereum'],
  [/avalanche/i, 'avalanche'],
  [/solana/i, 'solana'],
  [/^(xrp|ripple)/i, 'xrp'],
  [/cardano/i, 'cardano'],
  [/polkadot|kusama/i, 'polkadot'],
  [/^tron/i, 'tron'],
  [/cosmos|osmosis|akash|juno|secret network/i, 'cosmos'],
  [/^near/i, 'near'],
  [/^ton$/i, 'ton'],
  [/aptos/i, 'aptos'],
  [/^sui/i, 'sui'],
  [/stellar/i, 'stellar'],
];

export function inferLedgerFamily(name: string): LedgerAppFamily {
  const trimmed = name.trim();
  for (const [pattern, family] of FAMILY_RULES) {
    if (pattern.test(trimmed)) {
      return family;
    }
  }
  return 'unknown';
}

export function slugLedgerApp(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug === 'cardano-ada') {
    return 'cardano';
  }
  if (slug === 'ripple') {
    return 'xrp';
  }
  return slug || 'app';
}

function chipFor(name: string, family: LedgerAppFamily): string {
  if (family !== 'unknown') {
    const chips: Record<Exclude<LedgerAppFamily, 'unknown'>, string> = {
      bitcoin: 'BTC',
      ethereum: 'ETH',
      avalanche: 'AVAX',
      solana: 'SOL',
      xrp: 'XRP',
      cardano: 'ADA',
      polkadot: 'DOT',
      tron: 'TRX',
      cosmos: 'ATOM',
      near: 'NEAR',
      ton: 'TON',
      aptos: 'APT',
      sui: 'SUI',
      stellar: 'XLM',
    };
    if (name.toLowerCase().includes('litecoin')) {
      return 'LTC';
    }
    if (name.toLowerCase().includes('doge')) {
      return 'DOGE';
    }
    return chips[family];
  }
  return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'APP';
}

/** Bundled Manager snapshot so BLE works offline. Overlay replaces this after Update. */
export const LEDGER_INSTALLED_APPS: readonly LedgerInstalledApp[] = LEDGER_MANAGER_SNAPSHOT;

let overlay: LedgerInstalledApp[] | undefined;

export function ledgerCatalog(): readonly LedgerInstalledApp[] {
  return overlay && overlay.length > 0 ? overlay : LEDGER_INSTALLED_APPS;
}

export function setLedgerCatalogOverlay(apps: LedgerInstalledApp[] | undefined): void {
  overlay = apps && apps.length > 0 ? apps : undefined;
}

export function resetLedgerCatalogOverlay(): void {
  overlay = undefined;
}

export function fromManagerRow(name: string, version: string): LedgerInstalledApp {
  const family = inferLedgerFamily(name);
  const id = slugLedgerApp(name);
  return {
    id,
    openAppName: name,
    version,
    chip: chipFor(name, family),
    family,
  };
}

export const LEDGER_APPS: LedgerApp[] = [
  'dashboard',
  ...LEDGER_INSTALLED_APPS.map((app) => app.id),
];

/** Hardware-wallet usage: BTC, ETH, SOL, then other large-cap apps. Unknown ids follow alphabetically. */
const PICKER_RANK: Record<string, number> = {
  bitcoin: 0,
  ethereum: 1,
  solana: 2,
  xrp: 3,
  dogecoin: 4,
  cardano: 5,
  litecoin: 6,
  tron: 7,
  ton: 8,
  avalanche: 9,
  sui: 10,
  polkadot: 11,
  near: 12,
  cosmos: 13,
  aptos: 14,
};

export function ledgerPickerRank(id: string): number {
  return PICKER_RANK[id] ?? 1000;
}

export function ledgerPickerApps(): LedgerApp[] {
  const apps = [...ledgerCatalog()].sort((a, b) => {
    const rank = ledgerPickerRank(a.id) - ledgerPickerRank(b.id);
    if (rank !== 0) {
      return rank;
    }
    return a.openAppName.localeCompare(b.openAppName);
  });
  return ['dashboard', ...apps.map((app) => app.id)];
}

export function ledgerInstalledApp(id: LedgerApp): LedgerInstalledApp | undefined {
  if (id === 'dashboard') {
    return undefined;
  }
  return ledgerCatalog().find((app) => app.id === id);
}

export function ledgerAppFamily(app: LedgerApp): LedgerAppFamily | 'dashboard' {
  if (app === 'dashboard') {
    return 'dashboard';
  }
  return ledgerInstalledApp(app)?.family ?? inferLedgerFamily(app);
}

export function catalogVersion(id: string, fallback: string): string {
  const apps = ledgerCatalog();
  const exact = apps.find((app) => app.id === id);
  if (exact) {
    return exact.version;
  }
  const family = apps.find((app) => app.family === id);
  return family?.version ?? fallback;
}

export function ledgerAppLabel(app: LedgerApp): string {
  if (app === 'dashboard') {
    return 'BOLOS dashboard';
  }
  return ledgerInstalledApp(app)?.openAppName ?? app;
}

export function ledgerAppChip(app: LedgerApp): string {
  if (app === 'dashboard') {
    return 'BOLOS';
  }
  return ledgerInstalledApp(app)?.chip ?? app.slice(0, 4).toUpperCase();
}

export function matchLedgerApp(name: string): LedgerApp | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'bolos' || normalized === 'dashboard') {
    return 'dashboard';
  }
  const catalog = ledgerCatalog();
  const exact = catalog.find(
    (app) => app.openAppName.toLowerCase() === normalized || app.id === normalized,
  );
  if (exact) {
    return exact.id;
  }
  const partial = catalog.find(
    (app) =>
      normalized.includes(app.openAppName.toLowerCase()) ||
      app.openAppName.toLowerCase().includes(normalized),
  );
  return partial?.id;
}
