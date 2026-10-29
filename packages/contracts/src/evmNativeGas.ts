/**
 * Native gas token shown on an EVM sign sheet.
 *
 * The Ethereum app (CLA 0xE0) signs every EVM chain. The Avalanche app answers
 * C-Chain on that same CLA; X/P stay on CLA 0x80 and already display AVAX.
 * Catalog chips are not tickers — Ethereum Classic is family `ethereum`, so
 * its chip is ETH. There is no Ledger CAL in this repo. The table is the
 * 18-decimal networks that path can sign. Polygon mainnet gas is POL.
 * Gnosis gas is xDAI. An unknown chain id stays `native` instead of ETH.
 * A host network ticker is used only for an unknown chain id, and the sheet
 * marks it unverified.
 */

export type EvmNativeGas = {
  symbol: string;
  name: string;
  known: boolean;
  hostProvided: boolean;
};

export type EvmHostNetwork = {
  ticker: string;
  chainId: number;
  name?: string;
};

export const EVM_UNKNOWN_GAS_SYMBOL = 'native';

export const HOST_NETWORK_TICKER_WARNING =
  'Network ticker was provided by the host and is not verified.';

type GasRow = { symbol: string; name: string };

const CHAINS = new Map<bigint, GasRow>();

function add(chainId: number, symbol: string, name: string): void {
  CHAINS.set(BigInt(chainId), { symbol, name });
}

for (const [chainId, name] of [
  [1, 'Ethereum'],
  [5, 'Goerli'],
  [17000, 'Holesky'],
  [560048, 'Hoodi'],
  [11155111, 'Sepolia'],
  [10, 'Optimism'],
  [11155420, 'OP Sepolia'],
  [42161, 'Arbitrum One'],
  [42170, 'Arbitrum Nova'],
  [421614, 'Arbitrum Sepolia'],
  [8453, 'Base'],
  [84532, 'Base Sepolia'],
  [324, 'zkSync Era'],
  [59144, 'Linea'],
  [534352, 'Scroll'],
  [81457, 'Blast'],
  [1101, 'Polygon zkEVM'],
  [288, 'Boba'],
] as const) {
  add(chainId, 'ETH', name);
}

add(43114, 'AVAX', 'Avalanche C-Chain');
add(43113, 'AVAX', 'Avalanche Fuji');
add(137, 'POL', 'Polygon');
add(80002, 'POL', 'Polygon Amoy');
add(56, 'BNB', 'BNB Smart Chain');
add(97, 'BNB', 'BNB Chapel');
add(204, 'BNB', 'opBNB');
add(250, 'FTM', 'Fantom');
add(4002, 'FTM', 'Fantom Testnet');
add(100, 'xDAI', 'Gnosis');
add(10200, 'xDAI', 'Gnosis Chiado');
add(61, 'ETC', 'Ethereum Classic');
add(63, 'ETC', 'Ethereum Classic Mordor');
add(1284, 'GLMR', 'Moonbeam');
add(1285, 'MOVR', 'Moonriver');
add(1287, 'DEV', 'Moonbase');
add(1666600000, 'ONE', 'Harmony');
add(4689, 'IOTX', 'IoTeX');
add(248, 'OAS', 'Oasys');
add(30, 'RBTC', 'Rootstock');
add(19, 'SGB', 'Songbird');
add(146, 'S', 'Sonic');
add(108, 'TT', 'ThunderCore');
add(8, 'UBQ', 'Ubiq');
add(888, 'WAN', 'Wanchain');
add(50, 'XDC', 'XDC Network');
add(1329, 'SEI', 'Sei');
add(42220, 'CELO', 'Celo');
add(14, 'FLR', 'Flare');
add(80094, 'BERA', 'Berachain');
add(5000, 'MNT', 'Mantle');
add(25, 'CRO', 'Cronos');
add(1088, 'METIS', 'Metis');
add(592, 'ASTR', 'Astar');
add(336, 'SDN', 'Shiden');
add(246, 'EWT', 'Energy Web Chain');
add(1313114, 'ETHO', 'Ether-1');
add(1987, 'EGEM', 'EtherGem');
add(31102, 'ESN', 'Ethersocial');

/** Apps whose CLA 0xE0 traffic is one gas token, not the multi-chain Ethereum app. */
const DEDICATED_APP: Record<string, GasRow> = {
  avalanche: { symbol: 'AVAX', name: 'Avalanche C-Chain' },
  'ethereum-classic': { symbol: 'ETC', name: 'Ethereum Classic' },
};

const TICKER = /^[A-Za-z][A-Za-z0-9]{1,11}$/;
const NETWORK_NAME = /^[\x20-\x7e]{1,31}$/;

export function evmChainId(value: number | bigint | Uint8Array | undefined): bigint | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'bigint') {
    return value >= 0n ? value : undefined;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      return undefined;
    }
    return BigInt(value);
  }
  if (value.length === 0) {
    return undefined;
  }
  let out = 0n;
  for (const byte of value) {
    out = (out << 8n) + BigInt(byte);
  }
  return out;
}

function hostGas(host: EvmHostNetwork | undefined, chainId: bigint | undefined): EvmNativeGas | undefined {
  if (!host || chainId == null || !Number.isSafeInteger(host.chainId)) {
    return undefined;
  }
  if (BigInt(host.chainId) !== chainId || !TICKER.test(host.ticker)) {
    return undefined;
  }
  const name = host.name && NETWORK_NAME.test(host.name) ? host.name : host.ticker;
  return { symbol: host.ticker, name, known: false, hostProvided: true };
}

export function resolveEvmNativeGas(input: {
  chainId?: number | bigint | Uint8Array;
  app?: string;
  host?: EvmHostNetwork;
}): EvmNativeGas {
  const appId = input.app?.trim().toLowerCase();
  const dedicated = appId ? DEDICATED_APP[appId] : undefined;
  if (dedicated) {
    return { ...dedicated, known: true, hostProvided: false };
  }
  const chainId = evmChainId(input.chainId);
  if (chainId != null) {
    const known = CHAINS.get(chainId);
    if (known) {
      return { ...known, known: true, hostProvided: false };
    }
  }
  const host = hostGas(input.host, chainId);
  if (host) {
    return host;
  }
  if (chainId == null) {
    return { symbol: 'ETH', name: 'Ethereum', known: true, hostProvided: false };
  }
  return { symbol: EVM_UNKNOWN_GAS_SYMBOL, name: 'EVM', known: false, hostProvided: false };
}

export function evmSignTitle(gas: EvmNativeGas): string {
  if (gas.name === 'Ethereum' && !gas.hostProvided) {
    return 'Sign Ethereum transaction';
  }
  return `Sign ${gas.name} transaction`;
}
