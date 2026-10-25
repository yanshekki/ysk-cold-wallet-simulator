import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAIN_PATHS,
  isValidDerivationPath,
  mergeChainPaths,
  overlayDerivationPath,
  pathFor,
  pathToComponents,
} from './derivation';

describe('derivation paths', () => {
  it('keeps Ledger NEAR default including the last hardened 1', () => {
    expect(DEFAULT_CHAIN_PATHS.near).toBe("m/44'/397'/0'/0'/1'");
  });

  it('accepts hardened custom paths', () => {
    expect(isValidDerivationPath("m/44'/60'/0'/0/0")).toBe(true);
    expect(isValidDerivationPath('44/60')).toBe(false);
  });

  it('merges per-seed overrides', () => {
    expect(pathFor('eth', { eth: "m/44'/60'/1'/0/0" })).toBe("m/44'/60'/1'/0/0");
    expect(mergeChainPaths({ near: "m/44'/397'/0'/0'/0'" }).near).toBe("m/44'/397'/0'/0'/0'");
  });

  it('applies a session overlay only when the family matches', () => {
    const overlay = { id: 'eth' as const, path: "m/44'/60'/1'/0/0" };
    expect(overlayDerivationPath("m/44'/60'/0'/0/0", ['eth'], overlay)).toBe("m/44'/60'/1'/0/0");
    expect(overlayDerivationPath("m/44'/501'/0'", ['sol-ledger', 'sol-phantom'], overlay)).toBe("m/44'/501'/0'");
    expect(overlayDerivationPath("m/44'/60'/0'/0/0", ['eth'], null)).toBe("m/44'/60'/0'/0/0");
  });

  it('round-trips hardened path components', () => {
    expect(pathToComponents("m/44'/501'/0'/0'")).toEqual([
      0x8000002c, 0x800001f5, 0x80000000, 0x80000000,
    ]);
  });
});
