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

function row(
  id: LedgerInstalledAppId,
  openAppName: string,
  version: string,
  chip: string,
  family: LedgerAppFamily,
): LedgerInstalledApp {
  return { id, openAppName, version, chip, family };
}

/** Bundled Manager snapshot so BLE works offline. Overlay replaces this after Update. */
export const LEDGER_INSTALLED_APPS: readonly LedgerInstalledApp[] = [
  row('bitcoin', 'Bitcoin', '2.4.2', 'BTC', 'bitcoin'),
  row('ethereum', 'Ethereum', '1.23.0', 'ETH', 'ethereum'),
  row('avalanche', 'Avalanche', '1.4.23', 'AVAX', 'avalanche'),
  row('solana', 'Solana', '1.16.0', 'SOL', 'solana'),
  row('xrp', 'XRP', '2.6.1', 'XRP', 'xrp'),
  row('cardano', 'Cardano', '7.2.1', 'ADA', 'cardano'),
  row('polkadot', 'Polkadot', '100.0.11', 'DOT', 'polkadot'),
  row('tron', 'Tron', '0.8.3', 'TRX', 'tron'),
  row('cosmos', 'Cosmos', '2.36.15', 'ATOM', 'cosmos'),
  row('near', 'NEAR', '1.3.2', 'NEAR', 'near'),
  row('ton', 'TON', '2.2.0', 'TON', 'ton'),
  row('aptos', 'Aptos', '0.9.0', 'APT', 'aptos'),
  row('sui', 'Sui', '0.9.2', 'SUI', 'sui'),
  row('dogecoin', 'Dogecoin', '2.2.3', 'DOGE', 'bitcoin'),
  row('litecoin', 'Litecoin', '2.2.3', 'LTC', 'bitcoin'),
];

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

export function ledgerPickerApps(): LedgerApp[] {
  return ['dashboard', ...ledgerCatalog().map((app) => app.id)];
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
