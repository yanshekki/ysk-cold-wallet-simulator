export type LedgerInstalledAppId =
  | 'bitcoin'
  | 'ethereum'
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

export type LedgerApp = 'dashboard' | LedgerInstalledAppId;

export type LedgerInstalledApp = {
  id: LedgerInstalledAppId;
  openAppName: string;
  version: string;
  chip: string;
};

/** Manager-installed BLE catalog. ETH 1.23.0 / BTC 2.4.2 from GitHub; others from Manager snapshot 24 Oct 2026. */
export const LEDGER_INSTALLED_APPS: readonly LedgerInstalledApp[] = [
  { id: 'bitcoin', openAppName: 'Bitcoin', version: '2.4.2', chip: 'BTC' },
  { id: 'ethereum', openAppName: 'Ethereum', version: '1.23.0', chip: 'ETH' },
  { id: 'solana', openAppName: 'Solana', version: '1.16.0', chip: 'SOL' },
  { id: 'xrp', openAppName: 'XRP', version: '2.6.1', chip: 'XRP' },
  { id: 'cardano', openAppName: 'Cardano', version: '7.2.1', chip: 'ADA' },
  { id: 'polkadot', openAppName: 'Polkadot', version: '100.0.11', chip: 'DOT' },
  { id: 'tron', openAppName: 'Tron', version: '0.8.3', chip: 'TRX' },
  { id: 'cosmos', openAppName: 'Cosmos', version: '2.36.15', chip: 'ATOM' },
  { id: 'near', openAppName: 'NEAR', version: '1.3.2', chip: 'NEAR' },
  { id: 'ton', openAppName: 'TON', version: '2.2.0', chip: 'TON' },
  { id: 'aptos', openAppName: 'Aptos', version: '0.9.0', chip: 'APT' },
  { id: 'sui', openAppName: 'Sui', version: '0.9.2', chip: 'SUI' },
  { id: 'dogecoin', openAppName: 'Dogecoin', version: '2.2.3', chip: 'DOGE' },
  { id: 'litecoin', openAppName: 'Litecoin', version: '2.2.3', chip: 'LTC' },
];

export const LEDGER_APPS: LedgerApp[] = [
  'dashboard',
  ...LEDGER_INSTALLED_APPS.map((app) => app.id),
];

export function ledgerInstalledApp(id: LedgerApp): LedgerInstalledApp | undefined {
  return LEDGER_INSTALLED_APPS.find((app) => app.id === id);
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
  const exact = LEDGER_INSTALLED_APPS.find(
    (app) => app.openAppName.toLowerCase() === normalized || app.id === normalized,
  );
  if (exact) {
    return exact.id;
  }
  const partial = LEDGER_INSTALLED_APPS.find((app) =>
    normalized.includes(app.openAppName.toLowerCase()),
  );
  return partial?.id;
}
