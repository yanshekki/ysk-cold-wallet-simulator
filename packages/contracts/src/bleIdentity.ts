/**
 * BLE GATT identities for the simulated wallets.
 *
 * Ledger service UUIDs differ by model. OneKey models share one service and
 * differ by GAP name. Trezor Safe 7 has its own service. Phones of the same
 * model share that model's service UUID; the radio address is assigned by
 * the phone OS.
 *
 * Ledger (normal mode, not the rare Gen5 bootloader set `9004`):
 * https://developers.ledger.com/docs/device-interaction/references/identifiers
 * https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledgerjs/packages/devices/src/index.ts
 *
 * Trezor Safe 7 THP:
 * https://github.com/trezor/trezor-firmware/blob/main/python/src/trezorlib/transport/ble.py
 *
 * OneKey (Classic through Pro 2 / Neo):
 * https://github.com/OneKeyHQ/hardware-js-sdk/blob/onekey/packages/shared/src/constants.ts
 * https://developer.onekey.so/en/hardware-sdk/concepts/low-level-plugin/
 */

export const LEDGER_BLE_SEGMENT = {
  'nano-x': '0004',
  flex: '3004',
  stax: '6004',
  gen5: '8004',
} as const;

export type LedgerBleModelId = keyof typeof LEDGER_BLE_SEGMENT;

const LEDGER_UUID_PREFIX = '13d63400-2c97';
const LEDGER_UUID_TAIL = '4c6564676572';

export function ledgerBleUuid(segment: string, kind: '0000' | '0001' | '0002' | '0003'): string {
  return `${LEDGER_UUID_PREFIX}-${segment}-${kind}-${LEDGER_UUID_TAIL}`;
}

export function ledgerGatt(modelId: LedgerBleModelId): {
  serviceUUID: string;
  notifyCharUUID: string;
  writeCharUUID: string;
  writeCmdCharUUID: string;
} {
  const segment = LEDGER_BLE_SEGMENT[modelId];
  return {
    serviceUUID: ledgerBleUuid(segment, '0000'),
    notifyCharUUID: ledgerBleUuid(segment, '0001'),
    writeCharUUID: ledgerBleUuid(segment, '0002'),
    writeCmdCharUUID: ledgerBleUuid(segment, '0003'),
  };
}

/** RX is host→device (write). TX is device→host (notify). trezorlib does not require the optional push characteristic. */
export const TREZOR_BLE = {
  serviceUUID: '8c000001-a59b-4d58-a9ad-073df69fa1b1',
  writeCharUUID: '8c000002-a59b-4d58-a9ad-073df69fa1b1',
  notifyCharUUID: '8c000003-a59b-4d58-a9ad-073df69fa1b1',
} as const;

/** One communication service for every OneKey BLE model. Hosts scan this UUID and read the GAP name. */
export const ONEKEY_BLE = {
  serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
  writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
  notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
} as const;

type BleNamed = {
  id: string;
  brand: string;
  name: string;
  serviceUUID: string;
  writeCharUUID: string;
  notifyCharUUID: string;
  writeCmdCharUUID?: string;
};

const DEFAULT_ONEKEY_TOKEN: Record<string, string> = {
  classic: '1234',
  classic1s: 'A1B2',
  pure: '1234',
  touch: '1234',
  pro: 'A1B2',
  pro2: 'A1B2',
  neo: 'A1B2',
};

/**
 * OneKey Desktop accepts `K`/`T` + 4 digits, and `Pro` / `Pro 2` / `Neo` + 4 hex.
 * `Pro 22D8` is Pro, not Pro 2. See hardware-js-sdk `canonicalizePro2BleAdvertisementName`.
 */
const ONEKEY_GAP_PATTERNS: Record<string, RegExp> = {
  classic: /^k\d{4}(?:\s+[a-z0-9]{1,4})?$/i,
  classic1s: /^1s\s+[0-9a-f]{4}(?:\s+[a-z0-9]{1,4})?$/i,
  pure: /^p\d{4}(?:\s+[a-z0-9]{1,4})?$/i,
  touch: /^t\d{4}(?:\s+[a-z0-9]{1,4})?$/i,
  pro: /^pro\s+(?!2(?:\s|$))[0-9a-f]{4}(?:\s+[a-z0-9]{1,4})?$/i,
  pro2: /^pro\s*2\s+[0-9a-f]{4}(?:\s+[a-z0-9]{1,4})?$/i,
  neo: /^neo\s+[0-9a-f]{4}(?:\s+[a-z0-9]{1,4})?$/i,
};

const LEDGER_BLE_NAMES: Record<string, string> = {
  'nano-x': 'Nano X',
  flex: 'Flex',
  stax: 'Stax',
  gen5: 'Nano G5',
};

export function formatBleIdentityToken(bytes: Uint8Array): string {
  const value = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  return String(value % 10000).padStart(4, '0');
}

function digitToken(token: string | undefined): string | undefined {
  const digits = token?.replace(/\D/g, '').slice(0, 4) ?? '';
  return digits.length === 4 ? digits : undefined;
}

function hexToken(token: string | undefined): string | undefined {
  const hex = token?.replace(/[^0-9a-f]/gi, '').slice(0, 4).toUpperCase() ?? '';
  return hex.length === 4 ? hex : undefined;
}

function oneKeyToken(modelId: string, token: string | undefined): string {
  const digitsOnly = modelId === 'classic' || modelId === 'pure' || modelId === 'touch';
  const parsed = digitsOnly ? digitToken(token) : hexToken(token);
  return parsed ?? DEFAULT_ONEKEY_TOKEN[modelId] ?? '0000';
}

function oneKeyLocalName(modelId: string, token: string): string | undefined {
  switch (modelId) {
    case 'classic':
      return `K${token}`;
    case 'classic1s':
      return `1S ${token}`;
    case 'pure':
      return `P${token}`;
    case 'touch':
      return `T${token}`;
    case 'pro':
      return `Pro ${token}`;
    case 'pro2':
      return `Pro 2 ${token}`;
    case 'neo':
      return `Neo ${token}`;
    default:
      return undefined;
  }
}

export function bleAdvertiseName(model: BleNamed, token?: string): string {
  if (model.brand === 'onekey') {
    return oneKeyLocalName(model.id, oneKeyToken(model.id, token)) ?? model.name;
  }
  if (model.brand === 'ledger') {
    return LEDGER_BLE_NAMES[model.id] ?? model.name;
  }
  return model.name;
}

/** GAP local name actually put on the air. Ledger keeps the short product name. */
export function bleGapLocalName(
  model: BleNamed,
  options?: { token?: string; suffix?: string },
): string {
  const base = bleAdvertiseName(model, options?.token);
  const suffix = options?.suffix?.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) ?? '';
  if (!suffix || model.brand === 'ledger') {
    return base;
  }
  return `${base} ${suffix}`.trim();
}

function gapLabel(advertised: string): string {
  const name = advertised.trim();
  const bracket = name.match(/\[([^\]]+)\]\s*$/);
  return (bracket?.[1] ?? name).trim();
}

/** True when the advertised GAP name is this model's vendor pattern, including a per-phone token. */
export function bleGapNameMatches(model: BleNamed, advertised: string): boolean {
  if (model.brand !== 'onekey') {
    return false;
  }
  const pattern = ONEKEY_GAP_PATTERNS[model.id];
  if (!pattern) {
    return false;
  }
  return pattern.test(gapLabel(advertised));
}

export function ledgerServicesAreDistinct(models: BleNamed[]): boolean {
  const ledger = models.filter((model) => model.brand === 'ledger');
  if (ledger.length === 0) {
    return false;
  }
  const services = new Set(ledger.map((model) => model.serviceUUID.toLowerCase()));
  return services.size === ledger.length;
}

/** Service UUID and characteristics must belong to the same vendor model. A copied Nano X UUID fails. */
export function bleCharacteristicsMatchService(model: BleNamed): boolean {
  const service = model.serviceUUID.toLowerCase();
  const write = model.writeCharUUID.toLowerCase();
  const notify = model.notifyCharUUID.toLowerCase();
  const writeCmd = model.writeCmdCharUUID?.toLowerCase();
  if (model.brand === 'ledger') {
    const segment = LEDGER_BLE_SEGMENT[model.id as LedgerBleModelId];
    if (!segment) {
      return false;
    }
    return (
      service === ledgerBleUuid(segment, '0000') &&
      notify === ledgerBleUuid(segment, '0001') &&
      write === ledgerBleUuid(segment, '0002') &&
      writeCmd === ledgerBleUuid(segment, '0003')
    );
  }
  if (model.brand === 'trezor') {
    return (
      service === TREZOR_BLE.serviceUUID &&
      write === TREZOR_BLE.writeCharUUID &&
      notify === TREZOR_BLE.notifyCharUUID &&
      !writeCmd
    );
  }
  if (model.brand === 'onekey') {
    return (
      service === ONEKEY_BLE.serviceUUID &&
      write === ONEKEY_BLE.writeCharUUID &&
      notify === ONEKEY_BLE.notifyCharUUID &&
      !writeCmd
    );
  }
  return false;
}
