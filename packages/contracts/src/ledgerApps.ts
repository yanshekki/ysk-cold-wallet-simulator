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
  | 'ethereum-plugin'
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
  | 'tezos'
  | 'algorand'
  | 'multiversx'
  | 'filecoin'
  | 'stacks'
  | 'mina'
  | 'eos'
  | 'hedera'
  | 'neo'
  | 'casper'
  | 'flare'
  | 'conflux'
  | 'binance'
  | 'waves'
  | 'aion'
  | 'aleo'
  | 'alephium'
  | 'sia'
  | 'ergo'
  | 'arweave'
  | 'flow'
  | 'internetcomputer'
  | 'starknet'
  | 'hathor'
  | 'hive'
  | 'concordium'
  | 'symbol'
  | 'everscale'
  | 'qrl'
  | 'ardor'
  | 'fio'
  | 'utility'
  | 'unknown';

export type LedgerApp = 'dashboard' | string;

export type LedgerInstalledApp = {
  id: string;
  openAppName: string;
  /** Version reported to hosts, before a user pick is applied. */
  version: string;
  /**
   * Published versions synced for one device. Absent on the bundled snapshot;
   * the bundled index supplies choices until Update.
   */
  availableVersions?: readonly string[];
  chip: string;
  family: LedgerAppFamily;
};

/**
 * Exact Manager openAppName → family for Phase 2 remaps.
 * Covers ethereum CHAIN variants, bitcoin-like UTXO forks, cosmos-like,
 * polkadot-like, and ethereum clear-signing plugins (not standalone signers).
 * Keys are lowercased openAppName strings from the Nano X Manager snapshot.
 */
const FAMILY_BY_OPEN_NAME: Readonly<Record<string, LedgerAppFamily>> = {
  // ethereum CHAIN variants (app-ethereum makefile_conf/chain)
  akroma: 'ethereum',
  'artis sigma1': 'ethereum',
  atheios: 'ethereum',
  callisto: 'ethereum',
  dexon: 'ethereum',
  ellaism: 'ethereum',
  energywebchain: 'ethereum',
  'ether-1': 'ethereum',
  ethergem: 'ethereum',
  ethersocial: 'ethereum',
  expanse: 'ethereum',
  gochain: 'ethereum',
  harmony: 'ethereum',
  hpb: 'ethereum',
  id4good: 'ethereum',
  iotex: 'ethereum',
  mix: 'ethereum',
  moonbeam: 'ethereum',
  moonriver: 'ethereum',
  musicoin: 'ethereum',
  oasys: 'ethereum',
  pirl: 'ethereum',
  reosc: 'ethereum',
  rsk: 'ethereum',
  sei: 'ethereum',
  'shiden evm': 'ethereum',
  songbird: 'ethereum',
  sonic: 'ethereum',
  tecracoin: 'ethereum',
  thundercore: 'ethereum',
  tomochain: 'ethereum',
  ubiq: 'ethereum',
  wanchain: 'ethereum',
  webchain: 'ethereum',
  wethio: 'ethereum',
  'xdc network': 'ethereum',
  // bitcoin-like UTXO forks (reuse bitcoin handler; coin params differ)
  dash: 'bitcoin',
  digibyte: 'bitcoin',
  firo: 'bitcoin',
  gamecredits: 'bitcoin',
  horizen: 'bitcoin',
  hydra: 'bitcoin',
  komodo: 'bitcoin',
  lbry: 'bitcoin',
  nix: 'bitcoin',
  peercoin: 'bitcoin',
  pivx: 'bitcoin',
  ravencoin: 'bitcoin',
  stratis: 'bitcoin',
  vertcoin: 'bitcoin',
  viacoin: 'bitcoin',
  xrhodium: 'bitcoin',
  zclassic: 'bitcoin',
  // cosmos-like (Zondax CLA 55 pattern)
  'cronos pos chain': 'cosmos',
  desmos: 'cosmos',
  iov: 'cosmos',
  oasis: 'cosmos',
  persistence: 'cosmos',
  secret: 'cosmos',
  terra: 'cosmos',
  thorchain: 'cosmos',
  // polkadot / substrate-like
  'aleph zero': 'polkadot',
  avail: 'polkadot',
  peaq: 'polkadot',
  polymesh: 'polkadot',
  'xx network': 'polkadot',
  // ethereum APDU clones (CLA E0 core INS align; coin/path/extra INS may differ)
  vechain: 'ethereum',
  aeternity: 'ethereum',
  // Manager utility / non-signer apps (no standalone coin APDU target)
  exchange: 'utility',
  'fido u2f': 'utility',
  'security key': 'utility',
  'seed tool': 'utility',
  'recovery check': 'utility',
  'ledger sync': 'utility',
  // dedicated families researched this pass (official CLA/INS)
  'tezos wallet': 'tezos',
  algorand: 'algorand',
  multiversx: 'multiversx',
  filecoin: 'filecoin',
  stacks: 'stacks',
  mina: 'mina',
  eos: 'eos',
  hedera: 'hedera',
  neo: 'neo',
  'neo n3': 'neo',
  casper: 'casper',
  'flare network': 'flare',
  conflux: 'conflux',
  'binance chain': 'binance',
  waves: 'waves',
  aion: 'aion',
  aleo: 'aleo',
  alephium: 'alephium',
  sia: 'sia',
  ergo: 'ergo',
  arweave: 'arweave',
  flow: 'flow',
  internetcomputer: 'internetcomputer',
  starknet: 'starknet',
  hathor: 'hathor',
  hive: 'hive',
  concordium: 'concordium',
  symbol: 'symbol',
  everscale: 'everscale',
  qrl: 'qrl',
  ardor: 'ardor',
  fio: 'fio',
  // ethereum clear-signing plugins — companions, not standalone APDU apps
  '1inch': 'ethereum-plugin',
  alkemi: 'ethereum-plugin',
  angle: 'ethereum-plugin',
  apwine: 'ethereum-plugin',
  artblocks: 'ethereum-plugin',
  berachain: 'ethereum-plugin',
  'brick towers': 'ethereum-plugin',
  cbridge: 'ethereum-plugin',
  chorusone: 'ethereum-plugin',
  cian: 'ethereum-plugin',
  coinbase: 'ethereum-plugin',
  eigenlayer: 'ethereum-plugin',
  ens: 'ethereum-plugin',
  figment: 'ethereum-plugin',
  harvest: 'ethereum-plugin',
  hyperliquid: 'ethereum-plugin',
  kelp: 'ethereum-plugin',
  kiln: 'ethereum-plugin',
  lens: 'ethereum-plugin',
  libertify: 'ethereum-plugin',
  morpho: 'ethereum-plugin',
  nested: 'ethereum-plugin',
  'okx web3': 'ethereum-plugin',
  origin: 'ethereum-plugin',
  'p2p.org': 'ethereum-plugin',
  paraswap: 'ethereum-plugin',
  quickswap: 'ethereum-plugin',
  rarible: 'ethereum-plugin',
  ribbon: 'ethereum-plugin',
  'rocket pool': 'ethereum-plugin',
  spool: 'ethereum-plugin',
  squid: 'ethereum-plugin',
  staderlabs: 'ethereum-plugin',
  stakedao: 'ethereum-plugin',
  stakekit: 'ethereum-plugin',
  swell: 'ethereum-plugin',
  uniswap: 'ethereum-plugin',
  velora: 'ethereum-plugin',
  yearn: 'ethereum-plugin',
};

/** Regex fallbacks for Manager overlay names that share a family prefix/suffix. */
const FAMILY_RULES: [RegExp, LedgerAppFamily][] = [
  [/^bitcoin/i, 'bitcoin'],
  [/litecoin/i, 'bitcoin'],
  [/dogecoin/i, 'bitcoin'],
  [/ethereum/i, 'ethereum'],
  [/avalanche/i, 'avalanche'],
  [/solana/i, 'solana'],
  [/^(xrp|ripple)/i, 'xrp'],
  [/cardano/i, 'cardano'],
  [/polkadot|kusama|aleph zero|polymesh|xx network/i, 'polkadot'],
  [/^tron/i, 'tron'],
  [/cosmos|osmosis|akash|juno|secret network|thorchain|cronos pos/i, 'cosmos'],
  [/^near/i, 'near'],
  [/^ton$/i, 'ton'],
  [/aptos/i, 'aptos'],
  [/^sui/i, 'sui'],
  [/stellar/i, 'stellar'],
  [/tezos/i, 'tezos'],
  [/algorand/i, 'algorand'],
  [/multiversx|elrond/i, 'multiversx'],
  [/filecoin/i, 'filecoin'],
  [/stacks/i, 'stacks'],
  [/^mina$/i, 'mina'],
  [/^eos$/i, 'eos'],
  [/^hedera$/i, 'hedera'],
  [/^neo( n3)?$/i, 'neo'],
  [/^casper$/i, 'casper'],
  [/flare/i, 'flare'],
  [/^conflux$/i, 'conflux'],
  [/binance chain/i, 'binance'],
  [/^waves$/i, 'waves'],
  [/^aion$/i, 'aion'],
  [/^aleo$/i, 'aleo'],
  [/^alephium$/i, 'alephium'],
  [/^sia$/i, 'sia'],
  [/^ergo$/i, 'ergo'],
  [/^arweave$/i, 'arweave'],
  [/^flow$/i, 'flow'],
  [/internet\s*computer/i, 'internetcomputer'],
  [/^starknet$/i, 'starknet'],
  [/^hathor$/i, 'hathor'],
  [/^hive$/i, 'hive'],
  [/^concordium$/i, 'concordium'],
  [/^symbol$/i, 'symbol'],
  [/^everscale$/i, 'everscale'],
  [/^qrl$/i, 'qrl'],
  [/^ardor$/i, 'ardor'],
  [/^fio$/i, 'fio'],
];

export function inferLedgerFamily(name: string): LedgerAppFamily {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'unknown';
  }
  const exact = FAMILY_BY_OPEN_NAME[trimmed.toLowerCase()];
  if (exact) {
    return exact;
  }
  for (const [pattern, family] of FAMILY_RULES) {
    if (pattern.test(trimmed)) {
      return family;
    }
  }
  return 'unknown';
}

/** True when the catalog name is an Ethereum clear-signing plugin companion. */
export function isLedgerEthereumPlugin(nameOrFamily: string): boolean {
  const trimmed = nameOrFamily.trim();
  if (trimmed === 'ethereum-plugin') {
    return true;
  }
  return inferLedgerFamily(trimmed) === 'ethereum-plugin';
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
    if (family === 'ethereum-plugin' || family === 'utility') {
      return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'UTIL';
    }
    const chips: Record<Exclude<LedgerAppFamily, 'unknown' | 'ethereum-plugin' | 'utility'>, string> = {
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
      tezos: 'XTZ',
      algorand: 'ALGO',
      multiversx: 'EGLD',
      filecoin: 'FIL',
      stacks: 'STX',
      mina: 'MINA',
      eos: 'EOS',
      hedera: 'HEDE',
      neo: 'NEO',
      casper: 'CASP',
      flare: 'FLAR',
      conflux: 'CONF',
      binance: 'BINA',
      waves: 'WAVE',
      aion: 'AION',
      aleo: 'ALEO',
      alephium: 'ALEP',
      sia: 'SIA',
      ergo: 'ERGO',
      arweave: 'ARWE',
      flow: 'FLOW',
      internetcomputer: 'INTE',
      starknet: 'STAR',
      hathor: 'HATH',
      hive: 'HIVE',
      concordium: 'CONC',
      symbol: 'SYMB',
      everscale: 'EVER',
      qrl: 'QRL',
      ardor: 'ARDO',
      fio: 'FIO',
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
let overlayModelId: string | null = null;
let versionPicks: Record<string, string> | undefined;

/** Snapshot, or the last Update, without user version picks. */
export function ledgerCatalogBase(): readonly LedgerInstalledApp[] {
  return overlay && overlay.length > 0 ? overlay : LEDGER_INSTALLED_APPS;
}

/** Device id the saved version lists were synced for. Null means bundled lists. */
export function ledgerCatalogModelId(): string | null {
  return overlay ? overlayModelId : null;
}

export function ledgerVersionPicks(): Readonly<Record<string, string>> {
  return versionPicks ?? {};
}

export function setLedgerVersionPicks(next: Readonly<Record<string, string>> | undefined): void {
  if (!next || Object.keys(next).length === 0) {
    versionPicks = undefined;
    return;
  }
  versionPicks = { ...next };
}

export function resetLedgerVersionPicks(): void {
  versionPicks = undefined;
}

/** Catalog hosts and the picker read. User picks replace the base version. */
export function ledgerCatalog(): readonly LedgerInstalledApp[] {
  const base = ledgerCatalogBase();
  if (!versionPicks) {
    return base;
  }
  let changed = false;
  const apps = base.map((app) => {
    const picked = versionPicks?.[app.id];
    if (!picked || picked === app.version) {
      return app;
    }
    changed = true;
    return { ...app, version: picked };
  });
  return changed ? apps : base;
}

export function setLedgerCatalogOverlay(
  apps: LedgerInstalledApp[] | undefined,
  modelId: string | null = null,
): void {
  if (!apps || apps.length === 0) {
    overlay = undefined;
    overlayModelId = null;
    return;
  }
  overlay = apps;
  overlayModelId = modelId && modelId.trim() ? modelId.trim() : null;
}

export function resetLedgerCatalogOverlay(): void {
  overlay = undefined;
  overlayModelId = null;
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
