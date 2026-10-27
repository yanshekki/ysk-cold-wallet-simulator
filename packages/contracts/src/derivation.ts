export type ChainPathId =
  | 'btc-legacy'
  | 'btc-nested'
  | 'btc-native'
  | 'btc-taproot'
  | 'eth'
  | 'avax'
  | 'near'
  | 'sol-ledger'
  | 'sol-phantom'
  | 'atom'
  | 'trx'
  | 'xrp'
  | 'ada'
  | 'dot'
  | 'ton'
  | 'apt'
  | 'sui'
  | 'ltc'
  | 'doge'
  | 'stellar'
  | 'tezos'
  | 'bnb';

export type ChainPathMap = Partial<Record<ChainPathId, string>>;

export type SessionPathOverlay = {
  id: ChainPathId;
  path: string;
};

export const CHAIN_PATH_IDS: ChainPathId[] = [
  'btc-legacy',
  'btc-nested',
  'btc-native',
  'btc-taproot',
  'eth',
  'avax',
  'near',
  'sol-ledger',
  'sol-phantom',
  'atom',
  'trx',
  'xrp',
  'ada',
  'dot',
  'ton',
  'apt',
  'sui',
  'ltc',
  'doge',
  'stellar',
  'tezos',
  'bnb',
];

export const DEFAULT_CHAIN_PATHS: Record<ChainPathId, string> = {
  'btc-legacy': "m/44'/0'/0'/0/0",
  'btc-nested': "m/49'/0'/0'/0/0",
  'btc-native': "m/84'/0'/0'/0/0",
  'btc-taproot': "m/86'/0'/0'/0/0",
  eth: "m/44'/60'/0'/0/0",
  avax: "m/44'/9000'/0'/0/0",
  near: "m/44'/397'/0'/0'/1'",
  'sol-ledger': "m/44'/501'/0'",
  'sol-phantom': "m/44'/501'/0'/0'",
  atom: "m/44'/118'/0'/0/0",
  trx: "m/44'/195'/0'/0/0",
  xrp: "m/44'/144'/0'/0/0",
  ada: "m/1852'/1815'/0'/0/0",
  dot: "m/44'/354'/0'/0'/0'",
  ton: "m/44'/607'/0'/0'/0'/0'",
  apt: "m/44'/637'/0'/0'/0'",
  sui: "m/44'/784'/0'/0'/0'",
  ltc: "m/84'/2'/0'/0/0",
  doge: "m/44'/3'/0'/0/0",
  stellar: "m/44'/148'/0'",
  tezos: "m/44'/1729'/0'",
  bnb: "m/44'/714'/0'/0/0",
};

export const CHAIN_PATH_LABELS: Record<ChainPathId, string> = {
  'btc-legacy': 'Bitcoin Legacy',
  'btc-nested': 'Bitcoin Nested SegWit',
  'btc-native': 'Bitcoin Native SegWit',
  'btc-taproot': 'Bitcoin Taproot',
  eth: 'Ethereum / EVM',
  avax: 'Avalanche X/P',
  near: 'NEAR',
  'sol-ledger': 'Solana (Ledger)',
  'sol-phantom': 'Solana (Phantom)',
  atom: 'Cosmos',
  trx: 'Tron',
  xrp: 'XRP',
  ada: 'Cardano',
  dot: 'Polkadot',
  ton: 'TON',
  apt: 'Aptos',
  sui: 'Sui',
  ltc: 'Litecoin',
  doge: 'Dogecoin',
  stellar: 'Stellar',
  tezos: 'Tezos',
  bnb: 'BNB Beacon',
};

const HARDENED = /^(m)(\/\d+'?)*$/;

export function pathFor(id: ChainPathId, overrides?: ChainPathMap): string {
  return overrides?.[id] ?? DEFAULT_CHAIN_PATHS[id];
}

export function isValidDerivationPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed.startsWith('m')) {
    return false;
  }
  return HARDENED.test(trimmed.replace(/ /g, ''));
}

export function mergeChainPaths(overrides?: ChainPathMap): Record<ChainPathId, string> {
  return { ...DEFAULT_CHAIN_PATHS, ...overrides };
}

export function overlayDerivationPath(
  apduPath: string,
  chains: readonly ChainPathId[],
  overlay: SessionPathOverlay | null | undefined,
): string {
  if (!overlay?.path) {
    return apduPath;
  }
  return chains.includes(overlay.id) ? overlay.path : apduPath;
}

export function applyConfirmationPath(
  resolvePath: ((apduPath: string, chains: readonly ChainPathId[]) => string) | undefined,
  path: string,
  chains: readonly ChainPathId[],
): string {
  return resolvePath?.(path, chains) ?? path;
}

export function pathToComponents(path: string): number[] {
  const trimmed = path.trim();
  if (!trimmed || trimmed === 'm') {
    return [];
  }
  const body = trimmed.startsWith('m/') ? trimmed.slice(2) : trimmed.startsWith('m') ? trimmed.slice(1) : trimmed;
  if (!body) {
    return [];
  }
  return body.split('/').filter(Boolean).map((part) => {
    const hardened = part.endsWith("'") || part.endsWith('h');
    const index = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    if (!Number.isFinite(index) || index < 0) {
      throw new Error(`invalid derivation path ${path}`);
    }
    return hardened ? (index | 0x80000000) >>> 0 : index >>> 0;
  });
}

export function componentsToPath(components: number[]): string {
  if (components.length === 0) {
    return 'm';
  }
  const parts = components.map((value) => {
    const hardened = (value & 0x80000000) !== 0;
    const index = value & 0x7fffffff;
    return hardened ? `${index}'` : String(index);
  });
  return `m/${parts.join('/')}`;
}
