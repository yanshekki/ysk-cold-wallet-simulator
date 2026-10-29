import { ALL_MODELS, bleAdvertiseName, type DeviceModel } from '@cws/contracts';

export type ScanHit = {
  id: string;
  name: string;
  services: string[];
};

export type RankedPick = {
  hit: ScanHit;
  model: DeviceModel;
  score: number;
};

/** SIG / Apple services that show up on an iPhone that is not running CWS. */
const SYSTEM_BLE_SHORT = new Set([
  '1800',
  '1801',
  '1805',
  '1806',
  '180a',
  '180f',
  '1812',
  'fd44',
  'fe8f',
  'fe9f',
  'fec8',
  'fe13',
  'fed8',
]);

const SYSTEM_BLE_FULL = new Set([
  // Continuity
  'd0611e78848c4dd4bbd091f57c6b9aca',
  // Nearby Interaction
  '9fa480e0496745488699d506f5dc85a5',
  // Apple Notification Center
  '7905f431b5ce4e99a40f4b1e122d00d0',
  // Apple Media Service
  '89d3502b0f36433a8ef4c502ad55f8dc',
]);

function normalizeUuid(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-f]/g, '');
}

function shortUuid(value: string): string {
  const n = normalizeUuid(value);
  if (n.length === 32 && n.startsWith('0000') && n.endsWith('00001000800000805f9b34fb')) {
    return n.slice(4, 8);
  }
  if (n.length === 4) {
    return n;
  }
  return n;
}

export function isCwsServiceUuid(value: string, models: DeviceModel[] = ALL_MODELS): boolean {
  const n = normalizeUuid(value);
  if (!n) {
    return false;
  }
  const short = shortUuid(n);
  return models.some((model) => {
    const want = normalizeUuid(model.serviceUUID);
    return n === want || short === shortUuid(want);
  });
}

export function isSystemBleUuid(value: string): boolean {
  const n = normalizeUuid(value);
  if (!n) {
    return false;
  }
  if (isCwsServiceUuid(value)) {
    return false;
  }
  const short = shortUuid(n);
  return SYSTEM_BLE_SHORT.has(short) || SYSTEM_BLE_FULL.has(n);
}

/** True when every advertised UUID is iOS/SIG system GATT — never a CWS wallet. */
export function isSystemOnlyServices(services: string[]): boolean {
  if (services.length === 0) {
    return false;
  }
  return services.every((item) => isSystemBleUuid(item));
}

export function gattFingerprint(services: string[]): string {
  return [...new Set(services.map((item) => normalizeUuid(item)).filter(Boolean))].sort().join(',');
}

function serviceMatch(advertised: string[], model: DeviceModel): boolean {
  const want = normalizeUuid(model.serviceUUID);
  const wantShort = shortUuid(want);
  return advertised.some((item) => {
    const have = normalizeUuid(item);
    return have === want || shortUuid(have) === wantShort;
  });
}

function gapLabel(advertised: string): string {
  const name = advertised.trim();
  const bracket = name.match(/\[([^\]]+)\]\s*$/);
  return (bracket?.[1] ?? name).trim();
}

/**
 * iOS CoreBluetooth reports `Sample的iPhone [Pro 2 A1B2]` when CWS localName
 * is wrapped by the phone GAP name. Android usually advertises the CWS name
 * alone. Use this only as a tie-break — both can be valid CWS advertisers.
 */
function hostWrapped(advertised: string): boolean {
  const name = advertised.trim();
  if (!/\[[^\]]+\]\s*$/.test(name)) {
    return false;
  }
  return /iphone|ipad|ipod|pixel|samsung|galaxy|huawei|honor|xiaomi|redmi|oppo|vivo|oneplus|nothing|motorola|nokia|sony|android/i.test(
    name,
  );
}

function nameScore(advertised: string, model: DeviceModel): number {
  const name = advertised.trim().toLowerCase();
  if (!name) {
    return 0;
  }
  const label = gapLabel(advertised).toLowerCase();
  const expected = bleAdvertiseName(model).toLowerCase();
  const modelName = model.name.toLowerCase();
  const labelHits =
    label === expected ||
    label === modelName ||
    (expected.length > 0 && (label.startsWith(`${expected} `) || label.startsWith(`${modelName} `)));
  let score = 0;
  if (labelHits) {
    score = 5;
  } else if (name.includes(modelName) || name === expected) {
    score = 4;
  } else if (name === modelName) {
    score = 3;
  } else if (name.includes(expected) || expected.includes(name) || name.includes(model.id)) {
    score = 2;
  } else {
    score = 1;
  }
  // Host-wrapped names still match OneKey's name-only floor (>= 4) but lose to
  // a bare GAP name such as `Pro 2 A1B2` on another phone.
  if (score >= 4 && hostWrapped(advertised)) {
    score -= 1;
  }
  return score;
}

function uniqueService(model: DeviceModel): boolean {
  return model.brand !== 'onekey';
}

export function looksLikeCwsName(name: string, models: DeviceModel[] = ALL_MODELS): boolean {
  return models.some((model) => nameScore(name, model) >= 2);
}

export function serviceUuids(models: DeviceModel[] = ALL_MODELS): string[] {
  return [...new Set(models.map((model) => model.serviceUUID.toLowerCase()))];
}

function scoreHit(
  hit: ScanHit,
  model: DeviceModel,
): number | null {
  if (isSystemOnlyServices(hit.services)) {
    return null;
  }
  const named = nameScore(hit.name, model);
  const matched = serviceMatch(hit.services, model);
  // Ledger/Trezor 128-bit UUIDs identify the device. A leftover GAP name
  // (Trezor → OneKey Classic 1s) with empty services must not pick Trezor.
  // OneKey often omits its 16-bit UUID, so name-only is allowed there.
  if (!matched && (uniqueService(model) || named < 4 || hit.services.length > 0)) {
    return null;
  }
  // OneKey's 00000001 UUID is shared (and is BT 0x0001). A leftover
  // GAP name must not beat a unique Ledger/Trezor UUID on the same phone.
  // Do not inflate the OneKey UUID bonus: +1 already beats name-only (40 vs 41)
  // while staying under unique-service +40 on a leaked-UUID iPhone.
  return (matched && uniqueService(model) ? 40 : 0) + named * 8 + (matched && !uniqueService(model) ? 1 : 0);
}

/**
 * Rank every advertiser that could be CWS. Proxy must try the next hit when
 * GATT has no writable CWS characteristic — never key solely on localName.
 */
export function rankModels(
  hits: ScanHit[],
  preferredId?: string,
  models: DeviceModel[] = ALL_MODELS,
): RankedPick[] {
  const pool = preferredId ? models.filter((model) => model.id === preferredId) : models;
  if (preferredId && pool.length === 0) {
    return [];
  }
  const bestByHit = new Map<string, RankedPick>();
  for (const hit of hits) {
    if (!hit.id) {
      continue;
    }
    for (const model of pool) {
      const score = scoreHit(hit, model);
      if (score === null) {
        continue;
      }
      const prev = bestByHit.get(hit.id);
      if (!prev || score > prev.score) {
        bestByHit.set(hit.id, { hit, model, score });
      }
    }
  }
  return [...bestByHit.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.hit.id.localeCompare(right.hit.id);
  });
}

export function pickModel(
  hits: ScanHit[],
  preferredId?: string,
  models: DeviceModel[] = ALL_MODELS,
): RankedPick | null {
  return rankModels(hits, preferredId, models)[0] ?? null;
}

export function probeHit(hits: ScanHit[]): ScanHit | undefined {
  const usable = hits.filter((hit) => hit.id && !isSystemOnlyServices(hit.services));
  const named = usable.filter((hit) => looksLikeCwsName(hit.name));
  const pool = named.length > 0 ? named : [];
  return pool.find((hit) => hit.services.length > 0) ?? pool.find((hit) => hit.id);
}

export function serviceFromWriteUuid(writeUuid: string): string | undefined {
  const raw = writeUuid.trim().toLowerCase();
  const n = normalizeUuid(raw);
  if (!n) {
    return undefined;
  }
  if (n === normalizeUuid('00000002-0000-1000-8000-00805f9b34fb') || n === '0002') {
    return '00000001-0000-1000-8000-00805f9b34fb';
  }
  if (n.startsWith('8c000002')) {
    return '8c000001-a59b-4d58-a9ad-073df69fa1b1';
  }
  if (n.startsWith('13d63400') && raw.includes('-0002-')) {
    return raw.replace('-0002-', '-0000-');
  }
  return undefined;
}

export function servicesFromGattError(message: string): string[] {
  const have = message.match(/have=([^\s]+)/i)?.[1];
  if (!have || have === 'none') {
    return [];
  }
  return [...new Set(have.split(',').map((item) => item.split('/')[0] ?? '').filter(Boolean))];
}

/** Connect reached a peripheral that is not a live CWS GATT server. */
export function isPhantomGattError(message: string): boolean {
  if (!/missing write|no GATT services/i.test(message)) {
    return false;
  }
  const gatt = servicesFromGattError(message);
  if (gatt.length === 0) {
    return true;
  }
  if (isSystemOnlyServices(gatt)) {
    return true;
  }
  return !gatt.some((item) => isCwsServiceUuid(item));
}
