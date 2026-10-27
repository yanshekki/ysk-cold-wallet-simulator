import { ALL_MODELS, bleAdvertiseName, type DeviceModel } from '@cws/contracts';

export type ScanHit = {
  id: string;
  name: string;
  services: string[];
};

function normalizeUuid(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-f]/g, '');
}

function serviceMatch(advertised: string[], model: DeviceModel): boolean {
  const want = normalizeUuid(model.serviceUUID);
  return advertised.some((item) => normalizeUuid(item) === want);
}

function gapLabel(advertised: string): string {
  const name = advertised.trim();
  const bracket = name.match(/\[([^\]]+)\]\s*$/);
  return (bracket?.[1] ?? name).trim();
}

function nameScore(advertised: string, model: DeviceModel): number {
  const name = advertised.trim().toLowerCase();
  if (!name) {
    return 0;
  }
  const label = gapLabel(advertised).toLowerCase();
  const expected = bleAdvertiseName(model).toLowerCase();
  const modelName = model.name.toLowerCase();
  if (label === expected || label === modelName) {
    return 5;
  }
  if (name.includes(modelName) || name === expected) {
    return 4;
  }
  if (name === modelName) {
    return 3;
  }
  if (name.includes(expected) || expected.includes(name) || name.includes(model.id)) {
    return 2;
  }
  return 1;
}

function uniqueService(model: DeviceModel): boolean {
  return model.brand !== 'onekey';
}

export function serviceUuids(models: DeviceModel[] = ALL_MODELS): string[] {
  return [...new Set(models.map((model) => model.serviceUUID.toLowerCase()))];
}

export function pickModel(
  hits: ScanHit[],
  preferredId?: string,
  models: DeviceModel[] = ALL_MODELS,
): { hit: ScanHit; model: DeviceModel } | null {
  const pool = preferredId ? models.filter((model) => model.id === preferredId) : models;
  if (preferredId && pool.length === 0) {
    return null;
  }
  let best: { hit: ScanHit; model: DeviceModel; score: number } | null = null;
  for (const hit of hits) {
    for (const model of pool) {
      const named = nameScore(hit.name, model);
      const matched = serviceMatch(hit.services, model);
      // Ledger/Trezor 128-bit UUIDs identify the device. A leftover GAP name
      // (Trezor → OneKey Classic 1s) with empty services must not pick Trezor.
      // OneKey often omits its 16-bit UUID, so name-only is allowed there.
      if (!matched && (uniqueService(model) || named < 4 || hit.services.length > 0)) {
        continue;
      }
      // OneKey's 00000001 UUID is shared (and is BT 0x0001). A leftover
      // GAP name must not beat a unique Ledger/Trezor UUID on the same phone.
      const score =
        (matched && uniqueService(model) ? 40 : 0) + named * 8 + (matched && !uniqueService(model) ? 1 : 0);
      if (!best || score > best.score) {
        best = { hit, model, score };
      }
    }
  }
  return best ? { hit: best.hit, model: best.model } : null;
}

export function probeHit(hits: ScanHit[]): ScanHit | undefined {
  return hits.find((hit) => hit.id && hit.services.length > 0) ?? hits.find((hit) => hit.id);
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
