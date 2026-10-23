/**
 * Host-visible firmware / OS strings. Snapshot 24 Oct 2026.
 *
 * Ledger OS: https://support.ledger.com/article/7103926130845-zd
 * Ledger ETH: https://github.com/LedgerHQ/app-ethereum/releases/tag/1.23.0
 * Ledger BTC: https://github.com/LedgerHQ/app-bitcoin-new/releases/tag/2.4.2
 * OneKey: https://data.onekey.so/config.json (firmware-v8 / firmware-v1, required:false)
 * Trezor Safe 7: https://data.trezor.io/firmware/t3w1/releases.json (2.13.0, required:false)
 *
 * Re-fetch those URLs before bumping. USB-only SKUs are not listed.
 */

export type VersionTriple = [number, number, number];

export type LedgerOsVersion = {
  se: string;
  mcu: string;
  bootloader: string;
};

export const LEDGER_OS: Record<string, LedgerOsVersion> = {
  'nano-x': { se: '2.7.1', mcu: '2.30', bootloader: '1.16' },
  stax: { se: '1.10.1', mcu: '2.30', bootloader: '1.16' },
  flex: { se: '1.6.1', mcu: '2.30', bootloader: '1.16' },
  gen5: { se: '1.1.1', mcu: '2.30', bootloader: '1.16' },
};

export const TREZOR_FIRMWARE = {
  major: 2,
  minor: 13,
  patch: 0,
} as const;

export type OneKeyFirmware = {
  firmware: VersionTriple;
  ble: VersionTriple;
  boot: VersionTriple;
  board: VersionTriple;
  se: VersionTriple;
};

export const ONEKEY_FIRMWARE: Record<string, OneKeyFirmware> = {
  classic: {
    firmware: [3, 12, 0],
    ble: [1, 4, 1],
    boot: [2, 0, 0],
    board: [1, 0, 0],
    se: [1, 1, 7],
  },
  classic1s: {
    firmware: [3, 21, 0],
    ble: [1, 5, 6],
    boot: [2, 0, 0],
    board: [1, 0, 0],
    se: [1, 3, 2],
  },
  pure: {
    firmware: [3, 21, 0],
    ble: [1, 5, 6],
    boot: [2, 0, 0],
    board: [1, 0, 0],
    se: [1, 3, 2],
  },
  touch: {
    firmware: [4, 12, 0],
    ble: [2, 3, 1],
    boot: [2, 5, 2],
    board: [1, 1, 0],
    se: [1, 1, 0],
  },
  pro: {
    firmware: [4, 21, 0],
    ble: [2, 3, 7],
    boot: [2, 8, 4],
    board: [1, 3, 1],
    se: [1, 1, 7],
  },
  pro2: {
    firmware: [1, 0, 3],
    ble: [1, 0, 22],
    boot: [1, 0, 2],
    board: [1, 0, 0],
    se: [1, 3, 2],
  },
  neo: {
    firmware: [1, 0, 3],
    ble: [1, 0, 22],
    boot: [1, 0, 2],
    board: [1, 0, 0],
    se: [1, 3, 2],
  },
};

export function formatVersion(version: VersionTriple): string {
  return version.join('.');
}

export function ledgerOsFor(modelId: string): LedgerOsVersion {
  return LEDGER_OS[modelId] ?? LEDGER_OS['nano-x'];
}

export function onekeyFirmwareFor(modelId: string): OneKeyFirmware {
  return ONEKEY_FIRMWARE[modelId] ?? ONEKEY_FIRMWARE.classic;
}
