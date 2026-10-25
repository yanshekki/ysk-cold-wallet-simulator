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

function nameScore(advertised: string, model: DeviceModel): number {
  const name = advertised.trim().toLowerCase();
  if (!name) {
    return 0;
  }
  const expected = bleAdvertiseName(model).toLowerCase();
  const modelName = model.name.toLowerCase();
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
      if (!serviceMatch(hit.services, model)) {
        continue;
      }
      const score = nameScore(hit.name, model);
      if (!best || score > best.score) {
        best = { hit, model, score };
      }
    }
  }
  return best ? { hit: best.hit, model: best.model } : null;
}
