import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Brand } from '@cws/contracts';
import { rankModels, type ScanHit } from './match';

/** Peripheral the user chose. The id is an OS Bluetooth identifier, not a seed. */
export type BleLockRecord = {
  id: string;
  name: string;
  modelId: string | null;
};

export type NearbyDevice = {
  id: string;
  name: string;
  rssi: number | null;
  services: string[];
  brand: Brand | null;
  modelId: string | null;
  modelName: string | null;
};

export type BleTargetSnapshot = {
  lock: BleLockRecord | null;
  generation: number;
};

export type BleTarget = {
  snapshot(): BleTargetSnapshot;
  /** Lock to this peripheral. Wakes a scan that is waiting for a choice. */
  select(record: BleLockRecord): void;
  /** Clear the lock. A live session drops and the list waits for another pick. */
  unlock(): void;
  /** Ask the scan loop to look again without changing the lock. */
  rescan(): void;
  /** Refresh the saved label. Does not wake the connect loop. */
  remember(partial: { name?: string; modelId?: string | null }): void;
  /**
   * Resolves on select, unlock, rescan, or abort.
   * A wake that nobody was waiting for is kept for the next call.
   */
  wait(signal: AbortSignal): Promise<void>;
  subscribe(listener: () => void): () => void;
};

type LockFile = {
  version: 1;
  id: string;
  name: string;
  modelId: string | null;
};

const NEARBY_CAP = 16;

/** CoreBluetooth uses 127 when it could not read RSSI. Values above 20 dBm are not a reading. */
export function normalizeRssi(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value > 20) {
    return null;
  }
  return Math.round(value);
}

export function cleanLock(record: BleLockRecord): BleLockRecord | null {
  const id = record.id.trim();
  if (!id) {
    return null;
  }
  const name = record.name.trim() || id;
  const modelId = record.modelId?.trim() || null;
  return { id, name, modelId };
}

/**
 * Local file for the locked peripheral. Override with CWS_BLE_LOCK_PATH.
 * macOS: ~/Library/Application Support/CWS Proxy/ble-lock.json
 * Linux: $XDG_CONFIG_HOME/cws-proxy/ble-lock.json or ~/.config/cws-proxy/ble-lock.json
 */
export function defaultBleLockPath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const override = env.CWS_BLE_LOCK_PATH?.trim();
  if (override) {
    return override;
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'CWS Proxy', 'ble-lock.json');
  }
  if (process.platform === 'win32') {
    const base = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming');
    return path.join(base, 'CWS Proxy', 'ble-lock.json');
  }
  const base = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config');
  return path.join(base, 'cws-proxy', 'ble-lock.json');
}

export function readBleLock(file: string): BleLockRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockFile>;
    if (typeof parsed.id !== 'string') {
      return null;
    }
    return cleanLock({
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.id,
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : null,
    });
  } catch {
    return null;
  }
}

export function writeBleLock(file: string, record: BleLockRecord | null): void {
  if (!record) {
    fs.rmSync(file, { force: true });
    return;
  }
  const body: LockFile = {
    version: 1,
    id: record.id,
    name: record.name,
    modelId: record.modelId,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** CWS-compatible advertisers, strongest RSSI first. System GATT alone is omitted. */
export function nearbyDevices(hits: ScanHit[], preferredModelId?: string): NearbyDevice[] {
  const rssiById = new Map(hits.map((hit) => [hit.id, normalizeRssi(hit.rssi)]));
  const devices = rankModels(hits, preferredModelId).map((pick) => ({
    id: pick.hit.id,
    name: pick.hit.name || pick.hit.id,
    rssi: rssiById.get(pick.hit.id) ?? null,
    services: pick.hit.services,
    brand: pick.model.brand,
    modelId: pick.model.id,
    modelName: pick.model.name,
  }));
  devices.sort((left, right) => {
    const leftRssi = left.rssi ?? Number.NEGATIVE_INFINITY;
    const rightRssi = right.rssi ?? Number.NEGATIVE_INFINITY;
    if (rightRssi !== leftRssi) {
      return rightRssi - leftRssi;
    }
    return left.id.localeCompare(right.id);
  });
  return devices.slice(0, NEARBY_CAP);
}

export function createBleTarget(initial: BleLockRecord | null, opts?: { file?: string }): BleTarget {
  let lock = initial ? cleanLock(initial) : null;
  let generation = 0;
  let pendingWake = false;
  const waiters = new Set<() => void>();
  const listeners = new Set<() => void>();

  function persist(): void {
    if (!opts?.file) {
      return;
    }
    try {
      writeBleLock(opts.file, lock);
    } catch {
      // A read-only config dir must not take down the transport.
    }
  }

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function wake(): void {
    generation += 1;
    const waiting = [...waiters];
    waiters.clear();
    if (waiting.length === 0) {
      pendingWake = true;
    } else {
      pendingWake = false;
      for (const resolve of waiting) {
        resolve();
      }
    }
    emit();
  }

  return {
    snapshot() {
      return { lock, generation };
    },
    select(record) {
      const next = cleanLock(record);
      if (!next) {
        return;
      }
      lock = next;
      persist();
      wake();
    },
    unlock() {
      if (!lock && !pendingWake) {
        lock = null;
        persist();
        emit();
        return;
      }
      lock = null;
      persist();
      wake();
    },
    rescan() {
      wake();
    },
    remember(partial) {
      if (!lock) {
        return;
      }
      const name = partial.name?.trim();
      const next = cleanLock({
        id: lock.id,
        name: name || lock.name,
        modelId: partial.modelId === undefined ? lock.modelId : partial.modelId,
      });
      if (!next || (next.name === lock.name && next.modelId === lock.modelId)) {
        return;
      }
      lock = next;
      persist();
      emit();
    },
    wait(signal) {
      if (signal.aborted || pendingWake) {
        pendingWake = false;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const done = () => {
          waiters.delete(done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        waiters.add(done);
        signal.addEventListener('abort', done, { once: true });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
