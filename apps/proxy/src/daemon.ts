import { ALL_MODELS, type DeviceModel } from '@cws/contracts';
import { DEFAULT_MTU as LEDGER_MTU } from '@cws/protocol-ledger';
import { DEFAULT_MTU as ONEKEY_MTU } from '@cws/protocol-onekey';
import { attachLedger } from './adapters/ledger';
import { attachOneKey } from './adapters/onekey';
import { ThpClient } from './adapters/thp';
import { attachTrezor } from './adapters/trezor';
import type { LogFn } from './log';
import { pickModel, serviceUuids, type ScanHit } from './match';
import type { AdapterHandle, BlePort, HidPort } from './ports';
import type { StatusSink } from './status';
import { startTrezord, type TrezordHandle } from './trezord';

export type ConnectedBle = BlePort & {
  isConnected(): Promise<boolean>;
};

export type ProxyIo = {
  scan(uuids: string[], timeoutMs: number): Promise<ScanHit[]>;
  openBle(id: string, model: DeviceModel): Promise<ConnectedBle>;
  createHid(model: DeviceModel): HidPort;
  askPairingCode(): Promise<string>;
};

export type ProxyOptions = {
  scanMs?: number;
  modelId?: string;
  trezordPort?: number;
  once?: boolean;
  skipHid?: boolean;
  status?: StatusSink;
};

export async function runProxy(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  options: ProxyOptions = {},
): Promise<void> {
  const scanMs = options.scanMs ?? 4_000;
  const uuids = serviceUuids(ALL_MODELS);
  const status = options.status;
  while (!signal.aborted) {
    log('scanning');
    status?.patch({
      running: true,
      phase: 'scanning',
      hid: 'idle',
      hidError: null,
      pairing: false,
      trezord: null,
      error: null,
    });
    let hits: ScanHit[] = [];
    try {
      hits = await io.scan(uuids, scanMs);
    } catch (error) {
      log(`scan failed: ${String(error)}`);
    }
    const picked = pickModel(hits, options.modelId);
    if (!picked) {
      if (options.once) {
        throw new Error(options.modelId ? `no BLE device for ${options.modelId}` : 'no CWS device advertising');
      }
      await wait(1_000, signal);
      continue;
    }
    const { hit, model } = picked;
    log(
      `found ${model.brand} ${model.name} (${hit.name || hit.id}) services=${hit.services.join(',')}`,
    );
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
    try {
      await session(io, log, signal, model, hit, options);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      log(`session ended: ${message}`);
      status?.patch({ phase: 'error', error: message });
      await wait(8_000, signal);
    }
    if (options.once) {
      return;
    }
    await wait(500, signal);
  }
}

async function session(
  io: ProxyIo,
  log: LogFn,
  signal: AbortSignal,
  model: DeviceModel,
  hit: ScanHit,
  options: ProxyOptions,
): Promise<void> {
  const status = options.status;
  log('connecting');
  status?.patch({ phase: 'connecting' });
  const ble = await io.openBle(hit.id, model);
  log(`gatt ${model.writeCharUUID}`);
  status?.patch({ phase: 'gatt' });
  let hid: HidPort | undefined;
  let adapter: AdapterHandle | undefined;
  let thp: ThpClient | undefined;
  let bridge: TrezordHandle | undefined;
  try {
    if (model.brand === 'trezor') {
      thp = new ThpClient(ble, log, () => io.askPairingCode());
      await thp.start();
    }
    if (options.skipHid) {
      log('hid skipped (--no-hid). BLE is up; Chrome WebHID will not see a device.');
      status?.patch({ hid: 'skipped', hidError: null, phase: 'gatt' });
    } else {
      try {
        hid = io.createHid(model);
        log(
          `hid vid=0x${model.usb.vendorId.toString(16)} pid=0x${model.usb.productId.toString(16)} mtu=20`,
        );
        status?.patch({ hid: 'up', hidError: null, phase: 'hid' });
        if (model.brand === 'ledger') {
          adapter = attachLedger(hid, ble, LEDGER_MTU, log);
        } else if (model.brand === 'onekey') {
          const protocol = model.protocol === 'onekey-v2' ? 'onekey-v2' : 'onekey-v1';
          adapter = attachOneKey(hid, ble, protocol, ONEKEY_MTU, log);
        } else if (thp) {
          adapter = attachTrezor(hid, thp, log);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`hid failed: ${message}`);
        status?.patch({ hid: 'failed', hidError: message, phase: 'gatt' });
      }
    }
    if (thp) {
      try {
        bridge = await startTrezord(thp, model, log, options.trezordPort ?? 21325);
        status?.patch({ trezord: `http://127.0.0.1:${bridge.port}` });
      } catch (error) {
        log(`trezord skipped: ${String(error)}`);
      }
    }
    await waitUntilDropped(ble, signal);
  } finally {
    adapter?.close();
    hid?.close();
    thp?.close();
    await bridge?.close().catch(() => undefined);
    await ble.close().catch(() => undefined);
    log('session closed');
  }
}

async function waitUntilDropped(ble: ConnectedBle, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const connected = await ble.isConnected().catch(() => false);
    if (!connected) {
      return;
    }
    await wait(1_000, signal);
  }
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
