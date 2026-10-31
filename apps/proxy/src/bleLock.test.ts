import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanLock,
  createBleTarget,
  defaultBleLockPath,
  nearbyDevices,
  normalizeRssi,
  readBleLock,
  writeBleLock,
} from './bleLock';
import { bleAdvertiseName, LEDGER_MODELS, ONEKEY_MODELS } from '@cws/contracts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cws-ble-lock-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ble lock file', () => {
  it('stores the peripheral id and name, then deletes the file on clear', () => {
    const file = path.join(tempDir(), 'nested', 'ble-lock.json');
    writeBleLock(file, { id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readBleLock(file)).toEqual({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
    writeBleLock(file, null);
    expect(fs.existsSync(file)).toBe(false);
    expect(readBleLock(file)).toBeNull();
  });

  it('ignores a corrupt file and a blank id', () => {
    const dir = tempDir();
    const file = path.join(dir, 'ble-lock.json');
    fs.writeFileSync(file, '{', 'utf8');
    expect(readBleLock(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ id: '   ', name: 'x' }), 'utf8');
    expect(readBleLock(file)).toBeNull();
    expect(cleanLock({ id: '  ', name: '', modelId: null })).toBeNull();
    expect(readBleLock(path.join(dir, 'missing.json'))).toBeNull();
  });

  it('uses the platform config path unless CWS_BLE_LOCK_PATH is set', () => {
    expect(defaultBleLockPath({ CWS_BLE_LOCK_PATH: '  /tmp/cws-lock.json  ' }, '/home/me')).toBe(
      '/tmp/cws-lock.json',
    );
    const home = '/home/me';
    const file = defaultBleLockPath({}, home);
    if (process.platform === 'darwin') {
      expect(file).toBe(path.join(home, 'Library', 'Application Support', 'CWS Proxy', 'ble-lock.json'));
    } else if (process.platform === 'win32') {
      expect(file).toBe(path.join(home, 'AppData', 'Roaming', 'CWS Proxy', 'ble-lock.json'));
    } else {
      expect(file).toBe(path.join(home, '.config', 'cws-proxy', 'ble-lock.json'));
    }
    expect(defaultBleLockPath({ XDG_CONFIG_HOME: '/var/cws', APPDATA: '/var/cws' }, home)).toContain(
      'ble-lock.json',
    );
  });
});

describe('nearby devices', () => {
  it('lists compatible phones with RSSI and drops an unknown reading', () => {
    const nano = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const pro2 = ONEKEY_MODELS.find((item) => item.id === 'pro2')!;
    expect(normalizeRssi(127)).toBeNull();
    expect(normalizeRssi(-61.4)).toBe(-61);
    const listed = nearbyDevices([
      { id: 'quiet', name: 'Nano X A', services: [nano.serviceUUID], rssi: -80 },
      { id: 'loud', name: bleAdvertiseName(pro2), services: [pro2.serviceUUID], rssi: -42 },
      { id: 'buds', name: 'AirPods', services: ['180a', 'd0611e78-848c-4dd4-bbd0-91f57c6b9aca'], rssi: -20 },
      { id: 'blank', name: 'Nano X C', services: [nano.serviceUUID], rssi: 127 },
    ]);
    expect(listed.map((item) => item.id)).toEqual(['loud', 'quiet', 'blank']);
    expect(listed[0]).toMatchObject({ name: 'Pro 2 A1B2', rssi: -42, modelId: 'pro2', brand: 'onekey' });
    expect(listed[2]?.rssi).toBeNull();
  });
});

describe('ble target', () => {
  it('locks, persists, and does not clear the lock on rescan', async () => {
    const file = path.join(tempDir(), 'ble-lock.json');
    const target = createBleTarget(null, { file });
    const seen: Array<string | null> = [];
    target.subscribe(() => seen.push(target.snapshot().lock?.id ?? null));
    const waiting = target.wait(new AbortController().signal);
    target.select({ id: 'phone-a', name: ' Nano X A ', modelId: 'nano-x' });
    await waiting;
    expect(target.snapshot().lock).toEqual({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
    expect(readBleLock(file)?.id).toBe('phone-a');
    const generation = target.snapshot().generation;
    target.rescan();
    expect(target.snapshot().lock?.id).toBe('phone-a');
    expect(target.snapshot().generation).toBe(generation + 1);
    target.remember({ name: 'Nano X A2' });
    expect(target.snapshot().generation).toBe(generation + 1);
    expect(readBleLock(file)?.name).toBe('Nano X A2');
    target.unlock();
    expect(target.snapshot().lock).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
    expect(seen).toEqual(['phone-a', 'phone-a', 'phone-a', null]);
  });

  it('wakes a waiter that starts after rescan was requested', async () => {
    const target = createBleTarget({ id: 'phone-a', name: 'A', modelId: null });
    target.rescan();
    const signal = new AbortController().signal;
    await expect(target.wait(signal)).resolves.toBeUndefined();
    let settled = false;
    const hung = target.wait(signal).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    target.select({ id: 'phone-b', name: 'B', modelId: null });
    await hung;
    expect(target.snapshot().lock?.id).toBe('phone-b');
  });

  it('reloads the same peripheral from disk', () => {
    const file = path.join(tempDir(), 'ble-lock.json');
    createBleTarget(null, { file }).select({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
    const revived = createBleTarget(readBleLock(file), { file });
    expect(revived.snapshot().lock).toEqual({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
  });
});
