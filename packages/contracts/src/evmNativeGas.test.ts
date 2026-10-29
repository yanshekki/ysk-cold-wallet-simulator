import { describe, expect, it } from 'vitest';
import { EVM_UNKNOWN_GAS_SYMBOL, evmSignTitle, resolveEvmNativeGas } from './evmNativeGas';

const NETWORKS: Array<[number, string, string]> = [
  [1, 'ETH', 'Ethereum'],
  [11155111, 'ETH', 'Sepolia'],
  [43114, 'AVAX', 'Avalanche C-Chain'],
  [43113, 'AVAX', 'Avalanche Fuji'],
  [137, 'POL', 'Polygon'],
  [80002, 'POL', 'Polygon Amoy'],
  [56, 'BNB', 'BNB Smart Chain'],
  [97, 'BNB', 'BNB Chapel'],
  [42161, 'ETH', 'Arbitrum One'],
  [10, 'ETH', 'Optimism'],
  [8453, 'ETH', 'Base'],
  [250, 'FTM', 'Fantom'],
  [100, 'xDAI', 'Gnosis'],
  [61, 'ETC', 'Ethereum Classic'],
  [1284, 'GLMR', 'Moonbeam'],
  [1285, 'MOVR', 'Moonriver'],
  [42220, 'CELO', 'Celo'],
  [14, 'FLR', 'Flare'],
  [80094, 'BERA', 'Berachain'],
  [146, 'S', 'Sonic'],
  [1329, 'SEI', 'Sei'],
  [50, 'XDC', 'XDC Network'],
  [30, 'RBTC', 'Rootstock'],
  [5000, 'MNT', 'Mantle'],
];

describe('resolveEvmNativeGas', () => {
  it('maps known chain ids to their gas token', () => {
    for (const [chainId, symbol, name] of NETWORKS) {
      const gas = resolveEvmNativeGas({ chainId });
      expect(gas.symbol, String(chainId)).toBe(symbol);
      expect(gas.name, String(chainId)).toBe(name);
      expect(gas.known, String(chainId)).toBe(true);
      expect(gas.hostProvided, String(chainId)).toBe(false);
    }
  });

  it('reads a chain id from transaction bytes', () => {
    expect(resolveEvmNativeGas({ chainId: Uint8Array.of(0xa8, 0x6a) }).symbol).toBe('AVAX');
    expect(resolveEvmNativeGas({ chainId: Uint8Array.of(0x00, 0x00, 0xa8, 0x6a) }).name).toBe(
      'Avalanche C-Chain',
    );
  });

  it('keeps ETH for a legacy transaction that has no chain id', () => {
    const gas = resolveEvmNativeGas({});
    expect(gas).toMatchObject({ symbol: 'ETH', name: 'Ethereum', known: true });
    expect(evmSignTitle(gas)).toBe('Sign Ethereum transaction');
  });

  it('uses AVAX for the Avalanche app even when the template chain id is Ethereum', () => {
    const gas = resolveEvmNativeGas({ app: 'avalanche', chainId: 1 });
    expect(gas).toMatchObject({ symbol: 'AVAX', name: 'Avalanche C-Chain', known: true });
    expect(evmSignTitle(gas)).toBe('Sign Avalanche C-Chain transaction');
    expect(resolveEvmNativeGas({ app: 'avalanche', chainId: 11155111 }).symbol).toBe('AVAX');
  });

  it('uses the chain id when the open app is the multi-chain Ethereum app', () => {
    expect(resolveEvmNativeGas({ app: 'ethereum', chainId: 43114 }).symbol).toBe('AVAX');
    expect(resolveEvmNativeGas({ app: 'ethereum', chainId: 137 }).symbol).toBe('POL');
    expect(resolveEvmNativeGas({ app: 'ethereum', chainId: 8453 })).toMatchObject({
      symbol: 'ETH',
      name: 'Base',
    });
  });

  it('uses ETC for the Ethereum Classic app', () => {
    expect(resolveEvmNativeGas({ app: 'ethereum-classic', chainId: 1 })).toMatchObject({
      symbol: 'ETC',
      name: 'Ethereum Classic',
    });
  });

  it('does not call an unknown chain ETH', () => {
    const gas = resolveEvmNativeGas({ chainId: 424242 });
    expect(gas.symbol).toBe(EVM_UNKNOWN_GAS_SYMBOL);
    expect(gas.symbol).not.toBe('ETH');
    expect(gas.known).toBe(false);
    expect(evmSignTitle(gas)).toBe('Sign EVM transaction');
  });

  it('uses a host ticker only for an unknown chain id', () => {
    const host = { ticker: 'FOO', chainId: 424242, name: 'Foo Chain' };
    expect(resolveEvmNativeGas({ chainId: 424242, host })).toMatchObject({
      symbol: 'FOO',
      name: 'Foo Chain',
      hostProvided: true,
      known: false,
    });
    expect(resolveEvmNativeGas({ chainId: 43114, host: { ticker: 'ETH', chainId: 43114 } })).toMatchObject({
      symbol: 'AVAX',
      hostProvided: false,
    });
    expect(resolveEvmNativeGas({ chainId: 424242, host: { ticker: 'ETH', chainId: 1 } })).toMatchObject({
      symbol: EVM_UNKNOWN_GAS_SYMBOL,
      hostProvided: false,
    });
    expect(
      resolveEvmNativeGas({ chainId: 424242, host: { ticker: 'not a ticker', chainId: 424242 } }).symbol,
    ).toBe(EVM_UNKNOWN_GAS_SYMBOL);
  });
});
