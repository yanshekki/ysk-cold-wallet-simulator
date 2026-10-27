import { ALL_MODELS, type DeviceModel } from '@cws/contracts';
import { DEFAULT_MTU as LEDGER_MTU } from '@cws/protocol-ledger';
import { DEFAULT_MTU as ONEKEY_MTU } from '@cws/protocol-onekey';
import { attachLedger } from './adapters/ledger';
import { attachOneKey } from './adapters/onekey';
import { ThpClient } from './adapters/thp';
import { attachTrezor } from './adapters/trezor';
import type { LogFn } from './log';
import {
  pickModel,
  probeHit,
  serviceFromWriteUuid,
  serviceUuids,
  servicesFromGattError,
  type ScanHit,
} from './match';
import { createLabHandle, type LabHandle } from './lab';
import type { AdapterHandle, BlePort, ExclusiveLock, HidPort, NotifyRouter } from './ports';
import { createDeferredBle, createExclusive, createNotifyRouter } from './ports';
import type { StatusSink } from './status';
import { startTrezord, type TrezordHandle } from './trezord';

export type ConnectedBle = BlePort & {
  isConnected(): Promise<boolean>;
  debugInfo?: () => string;
};

export type ProxyIo = {
  scan(uuids: string[], timeoutMs: number): Promise<ScanHit[]>;
  openBle(id: string, model: DeviceModel): Promise<ConnectedBle>;
  createHid(model: DeviceModel, signal?: AbortSignal): HidPort | Promise<HidPort>;
  askPairingCode(): Promise<string>;
};

export type LabSlot = {
  set(handle: LabHandle | undefined): void;
};

export type HidHolder = {
  hid?: HidPort;
  model?: DeviceModel;
  adapter?: AdapterHandle;
  exclusive: ExclusiveLock;
  ble: ReturnType<typeof createDeferredBle>;
  hidState: 'idle' | 'up' | 'skipped' | 'failed';
};

export function createHidHolder(skipHid = false): HidHolder {
  return {
    exclusive: createExclusive(),
    ble: createDeferredBle(),
    hidState: skipHid ? 'skipped' : 'idle',
  };
}

export type ProxyOptions = {
  scanMs?: number;
  modelId?: string;
  trezordPort?: number;
  once?: boolean;
  skipHid?: boolean;
  persistHid?: boolean;
  holder?: HidHolder;
  status?: StatusSink;
  labSlot?: LabSlot;
};

function sameUsb(left: DeviceModel | undefined, right: DeviceModel): boolean {
  return (
    left?.usb.vendorId === right.usb.vendorId && left?.usb.productId === right.usb.productId
  );
}

function isTransientHidError(message: string): boolean {
  return /EPIPE|ECONNRESET|ECONNREFUSED|closed before open/i.test(message);
}

function writeUuidFromDebug(ble: ConnectedBle): string | undefined {
  const match = ble.debugInfo?.().match(/write=([0-9a-f-]+)/i);
  return match?.[1];
}

function confirmModel(hit: ScanHit, ble: ConnectedBle, guessed: DeviceModel): DeviceModel {
  const service = serviceFromWriteUuid(writeUuidFromDebug(ble) ?? '');
  if (!service) {
    return guessed;
  }
  const byGatt = pickModel([{ ...hit, services: [service] }]);
  if (!byGatt) {
    return guessed;
  }
  if (byGatt.model.brand === 'onekey') {
    const byName = pickModel([{ ...hit, services: [] }]);
    if (byName?.model.brand === 'onekey') {
      return byName.model;
    }
    return guessed.brand === 'onekey' ? guessed : byGatt.model;
  }
  return byGatt.model;
}

function probeGuess(hit: ScanHit, holder: HidHolder): DeviceModel | undefined {
  const picked = pickModel([hit]);
  if (picked) {
    return picked.model;
  }
  if (holder.model?.brand === 'onekey') {
    return holder.model;
  }
  return ALL_MODELS.find((item) => item.id === 'classic1s');
}

function attachAdapter(
  model: DeviceModel,
  hid: HidPort,
  ble: BlePort,
  log: LogFn,
  exclusive: ExclusiveLock,
  thp?: ThpClient,
): AdapterHandle | undefined {
  if (model.brand === 'ledger') {
    return attachLedger(hid, ble, LEDGER_MTU, log, model.id, exclusive);
  }
  if (model.brand === 'onekey') {
    const protocol = model.protocol === 'onekey-v2' ? 'onekey-v2' : 'onekey-v1';
    return attachOneKey(hid, ble, protocol, ONEKEY_MTU, log, exclusive);
  }
  if (thp) {
    return attachTrezor(hid, thp, log, exclusive);
  }
  return undefined;
}

async function ensureHid(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  options: ProxyOptions,
  holder: HidHolder,
  model: DeviceModel,
): Promise<void> {
  if (options.skipHid) {
    return;
  }
  if (holder.hid && sameUsb(holder.model, model)) {
    if (!holder.adapter && model.brand !== 'trezor') {
      holder.adapter = attachAdapter(model, holder.hid, holder.ble.port, log, holder.exclusive);
    }
    log(
      `hid reused vid=0x${model.usb.vendorId.toString(16)} pid=0x${model.usb.productId.toString(16)}`,
    );
    markHidUp(holder, options, model);
    return;
  }
  if (holder.hid?.switchModel) {
    holder.adapter?.close();
    holder.adapter = undefined;
    try {
      await abortable(signal, holder.hid.switchModel(model));
      holder.model = model;
      holder.adapter = attachAdapter(model, holder.hid, holder.ble.port, log, holder.exclusive);
      log(
        `hid switch vid=0x${model.usb.vendorId.toString(16)} pid=0x${model.usb.productId.toString(16)}`,
      );
      markHidUp(holder, options, model);
      return;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      log(`hid switch failed: ${message}`);
      holder.hid.close();
      holder.hid = undefined;
      holder.model = undefined;
    }
  } else {
    holder.adapter?.close();
    holder.hid?.close();
    holder.adapter = undefined;
    holder.hid = undefined;
    holder.model = undefined;
  }
  try {
    holder.hid = await createHidWithRetry(io, log, signal, model);
    holder.model = model;
    holder.adapter = attachAdapter(model, holder.hid, holder.ble.port, log, holder.exclusive);
    log(
      `hid vid=0x${model.usb.vendorId.toString(16)} pid=0x${model.usb.productId.toString(16)} mtu=20`,
    );
    markHidUp(holder, options, model);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    log(`hid failed: ${message}`);
    holder.hidState = 'failed';
    options.status?.patch({ hid: 'failed', hidError: message });
  }
}

function markHidUp(holder: HidHolder, options: ProxyOptions, model: DeviceModel): void {
  holder.hidState = 'up';
  options.status?.patch({
    hid: 'up',
    hidError: null,
    phase: 'hid',
    vendorId: model.usb.vendorId,
    productId: model.usb.productId,
    brand: model.brand,
    modelId: model.id,
    modelName: model.name,
  });
}

async function createHidWithRetry(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  model: DeviceModel,
): Promise<HidPort> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await abortable(signal, Promise.resolve().then(() => io.createHid(model, signal)));
    } catch (error) {
      last = error;
      if (signal.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!isTransientHidError(message) || attempt === 3) {
        throw error;
      }
      log(`hid retry ${attempt + 1}: ${message}`);
      await wait(80 * (attempt + 1), signal);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function runProxy(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  options: ProxyOptions = {},
): Promise<void> {
  const scanMs = options.scanMs ?? 4_000;
  const uuids = serviceUuids(ALL_MODELS);
  const status = options.status;
  const persistHid = Boolean(options.persistHid);
  const holder = options.holder ?? createHidHolder(options.skipHid);
  holder.ble.detach();
  holder.adapter?.close();
  holder.adapter = undefined;
  holder.exclusive = createExclusive();
  if (!holder.hid) {
    holder.hidState = options.skipHid ? 'skipped' : 'idle';
  }
  const seed =
    holder.model ??
    (options.modelId
      ? ALL_MODELS.find((item) => item.id === options.modelId)
      : undefined);
  try {
    if (!options.skipHid && seed) {
      await ensureHid(io, log, signal, options, holder, seed);
    }
    while (!signal.aborted) {
      log('scanning');
      status?.patch({
        running: true,
        phase: holder.hid ? 'hid' : 'scanning',
        hid: holder.hidState,
        pairing: false,
        trezord: null,
        error: null,
      });
      let hits: ScanHit[] = [];
      let scanError: unknown;
      try {
        hits = await abortable(signal, io.scan(uuids, scanMs));
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        scanError = error;
        log(`scan failed: ${String(error)}`);
      }
      const picked = pickModel(hits, options.modelId);
      const hit = picked?.hit ?? (options.modelId ? undefined : probeHit(hits));
      const guessed = picked?.model ?? (hit && !options.modelId ? probeGuess(hit, holder) : undefined);
      if (!hit || !guessed) {
        const nearby = hits
          .slice(0, 3)
          .map((item) => item.name || item.id)
          .filter(Boolean)
          .join(', ');
        log(`scan nearby=${hits.length}${nearby ? ` ${nearby}` : ''}`);
        if (options.once) {
          throw new Error(options.modelId ? `no BLE device for ${options.modelId}` : 'no CWS device advertising');
        }
        const denied = /permission denied|unauthorized|Bluetooth is off/i.test(String(scanError ?? ''));
        await wait(denied ? 5_000 : 1_000, signal);
        continue;
      }
      if (picked) {
        log(
          `found ${guessed.brand} ${guessed.name} (${hit.name || hit.id}) services=${hit.services.join(',')}`,
        );
      } else {
        log(`probe ${hit.name || hit.id} as ${guessed.brand} ${guessed.name} services=${hit.services.join(',')}`);
      }
      try {
        const opened = await openConfirmed(io, log, signal, hit, guessed);
        const model = opened.model;
        status?.patch({
          phoneName: hit.name || hit.id,
          brand: model.brand,
          modelId: model.id,
          modelName: model.name,
          protocol: model.protocol,
          serviceUUID: model.serviceUUID,
          vendorId: model.usb.vendorId,
          productId: model.usb.productId,
          mtu: 20,
        });
        await ensureHid(io, log, signal, options, holder, model);
        await session(io, log, signal, model, hit, options, holder, opened.ble);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        log(`session ended: ${message}`);
        status?.patch({ phase: 'error', error: message });
        const quick =
          /missing write|connect timed out|unknown peripheral|GATT|disconnected/i.test(message);
        await wait(quick ? 400 : 8_000, signal);
      }
      if (options.once) {
        return;
      }
      await wait(500, signal);
    }
  } finally {
    holder.ble.detach();
    holder.adapter?.close();
    holder.adapter = undefined;
    if (!persistHid) {
      holder.hid?.close();
      holder.hid = undefined;
      holder.model = undefined;
      if (holder.hidState === 'up') {
        holder.hidState = 'idle';
      }
    }
  }
}

async function openConfirmed(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  hit: ScanHit,
  guessed: DeviceModel,
): Promise<{ model: DeviceModel; ble: ConnectedBle }> {
  log('connecting');
  let model = guessed;
  let ble: ConnectedBle;
  try {
    ble = await abortable(signal, io.openBle(hit.id, model));
  } catch (error) {
    const gatt = servicesFromGattError(String(error));
    const rematch = gatt.length > 0 ? pickModel([{ ...hit, services: gatt }]) : null;
    if (!rematch || rematch.model.id === model.id) {
      throw error;
    }
    log(`gatt rematch ${rematch.model.brand} ${rematch.model.name} ${String(error)}`);
    model = rematch.model;
    ble = await abortable(signal, io.openBle(hit.id, model));
  }
  const confirmed = confirmModel(hit, ble, model);
  if (confirmed.id !== guessed.id) {
    log(`gatt confirmed ${confirmed.brand} ${confirmed.name}`);
  }
  return { model: confirmed, ble };
}

async function session(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  model: DeviceModel,
  hit: ScanHit,
  options: ProxyOptions,
  holder: HidHolder,
  opened?: ConnectedBle,
): Promise<void> {
  const status = options.status;
  status?.patch({ phase: holder.hid ? 'hid' : 'connecting' });
  let ble = opened ?? (await abortable(signal, io.openBle(hit.id, model)));
  log(`gatt ${model.writeCharUUID} ${ble.debugInfo?.() ?? ''}`.trim());
  let route = routeBle(ble);
  holder.ble.attach(route.port);
  status?.patch({ phase: holder.hid ? 'hid' : 'gatt' });
  let lab: LabHandle | undefined;
  let thp: ThpClient | undefined;
  let bridge: TrezordHandle | undefined;
  let stopped = false;
  const dropLab = () => {
    lab?.close();
    lab = undefined;
    options.labSlot?.set(undefined);
  };
  const stopIo = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    dropLab();
    holder.ble.detach();
    thp?.close();
  };
  const bindLab = (port: ConnectedBle, router: NotifyRouter) => {
    dropLab();
    lab = createLabHandle({
      brand: model.brand,
      ble: port,
      router,
      exclusive: holder.exclusive,
      log,
      adapter: () => holder.adapter,
      thp,
    });
    options.labSlot?.set(lab);
  };
  signal.addEventListener('abort', stopIo, { once: true });
  try {
    if (model.brand === 'trezor') {
      thp = new ThpClient(route.port, log, () => io.askPairingCode());
      await abortable(signal, thp.start());
      if (holder.hid && !holder.adapter) {
        holder.adapter = attachAdapter(
          model,
          holder.hid,
          holder.ble.port,
          log,
          holder.exclusive,
          thp,
        );
      }
    }
    if (options.skipHid) {
      log('hid skipped (--no-hid). BLE is up; Chrome WebHID will not see a device.');
      status?.patch({ hid: 'skipped', hidError: null, phase: 'gatt' });
    }
    bindLab(route.port, route.router);
    if (thp) {
      try {
        bridge = await abortable(
          signal,
          startTrezord(thp, model, log, options.trezordPort ?? 21325),
        );
        status?.patch({ trezord: `http://127.0.0.1:${bridge.port}` });
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        log(`trezord skipped: ${String(error)}`);
      }
    }
    while (!signal.aborted) {
      await waitUntilDropped(ble, signal);
      if (signal.aborted || options.once) {
        break;
      }
      log('ble dropped; keeping HID');
      dropLab();
      holder.ble.detach();
      route.release();
      await settle(ble.close(), 400);
      status?.patch({ phase: holder.hid ? 'hid' : 'connecting' });
      const next = await reconnectBle(io, log, signal, model, hit, options.scanMs ?? 4_000);
      if (!next) {
        log(`phone left ${model.id}; rescanning`);
        break;
      }
      ble = next;
      route = routeBle(ble);
      holder.ble.attach(route.port);
      log(`gatt ${model.writeCharUUID} ${ble.debugInfo?.() ?? ''}`.trim());
      status?.patch({ phase: holder.hid ? 'hid' : 'gatt' });
      if (model.brand === 'trezor') {
        thp?.close();
        thp = new ThpClient(route.port, log, () => io.askPairingCode());
        await abortable(signal, thp.start());
      }
      bindLab(route.port, route.router);
    }
  } finally {
    signal.removeEventListener('abort', stopIo);
    stopIo();
    route.release();
    await settle(bridge?.close() ?? Promise.resolve(), 400);
    await settle(ble.close(), 400);
    log('session closed');
  }
}

function routeBle(ble: ConnectedBle): {
  port: ConnectedBle;
  router: NotifyRouter;
  release: () => void;
} {
  const router = createNotifyRouter();
  const release = ble.onNotify((packet) => router.dispatch(packet));
  return {
    router,
    release,
    port: {
      write: (packet) => ble.write(packet),
      onNotify: (callback) => router.subscribe(callback),
      close: () => ble.close(),
      isConnected: () => ble.isConnected(),
      debugInfo: ble.debugInfo,
    },
  };
}

async function reconnectBle(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  model: DeviceModel,
  hit: ScanHit,
  scanMs: number,
): Promise<ConnectedBle | undefined> {
  try {
    return await abortable(signal, io.openBle(hit.id, model));
  } catch (error) {
    log(`reconnect ${hit.id}: ${String(error)}`);
  }
  while (!signal.aborted) {
    log('scanning');
    let hits: ScanHit[] = [];
    try {
      hits = await abortable(signal, io.scan(serviceUuids(ALL_MODELS), scanMs));
    } catch (error) {
      if (signal.aborted) {
        return undefined;
      }
      log(`scan failed: ${String(error)}`);
    }
    const picked = pickModel(hits);
    if (picked) {
      if (picked.model.id !== model.id) {
        log(`phone now ${picked.model.brand} ${picked.model.name}; dropping ${model.id} session`);
        return undefined;
      }
      hit.id = picked.hit.id;
      hit.name = picked.hit.name;
      hit.services = picked.hit.services;
      try {
        return await abortable(signal, io.openBle(hit.id, model));
      } catch (error) {
        log(`reconnect ${hit.id}: ${String(error)}`);
        if (/missing write/i.test(String(error))) {
          return undefined;
        }
      }
    }
    await wait(1_000, signal);
  }
  return undefined;
}

async function waitUntilDropped(ble: ConnectedBle, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    let connected = false;
    try {
      connected = await abortable(signal, ble.isConnected().catch(() => false));
    } catch {
      return;
    }
    if (!connected) {
      return;
    }
    await wait(1_000, signal);
  }
}

function abortable<T>(signal: AbortSignal, task: Promise<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error('aborted'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function settle(task: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    task.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}
