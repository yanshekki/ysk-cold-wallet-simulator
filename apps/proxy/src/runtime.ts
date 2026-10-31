import { createBleTarget, readBleLock, type BleTarget } from './bleLock';
import { createHidHolder, runProxy, type HidHolder, type ProxyIo, type ProxyOptions } from './daemon';
import type { Brand } from '@cws/contracts';
import { labCatalogFor, type LabCatalog, type LabDraftInput, type LabHandle } from './lab';
import type { LogFn } from './log';
import type { PairingGate } from './pairing';
import type { StatusBus } from './status';

export type RuntimeOptions = Omit<ProxyOptions, 'status' | 'bleTarget'> & {
  nativeReady?: boolean;
  /** Wait for an explicit phone, then keep the connection on that peripheral. */
  picker?: boolean;
  bleLockFile?: string;
};

export type ProxyRuntime = {
  start(): void;
  stop(): void;
  wait(): Promise<void>;
  busy(): boolean;
  labCatalog(requested?: Brand): LabCatalog;
  runLab(actionId: string, draft?: LabDraftInput): Promise<string>;
  setOpenAppName(name: string): void;
  selectBle(id: string): void;
  unlockBle(): void;
  rescanBle(): void;
};

export function teeLog(log: LogFn, bus: StatusBus): LogFn {
  return (line) => {
    bus.log(line);
    try {
      log(line);
    } catch {
      // stderr in the macOS app is a pipe; UI console must still receive the line
    }
  };
}

export function createRuntime(
  io: ProxyIo,
  log: LogFn,
  bus: StatusBus,
  parent: AbortSignal,
  options: RuntimeOptions = {},
  pairing?: PairingGate,
): ProxyRuntime {
  let abort: AbortController | undefined;
  let loop = Promise.resolve();
  let inFlight = false;
  let pendingStart = false;
  let lab: LabHandle | undefined;
  const nativeReady = options.nativeReady ?? true;
  const proxyLog = teeLog(log, bus);
  const holder: HidHolder = createHidHolder(options.skipHid);
  const bleLockFile = options.bleLockFile;
  const target: BleTarget | undefined = options.picker
    ? createBleTarget(bleLockFile ? readBleLock(bleLockFile) : null, { file: bleLockFile })
    : undefined;
  const publishLock = () => {
    if (!target) {
      return;
    }
    const lock = target.snapshot().lock;
    bus.patch({
      locked: Boolean(lock),
      targetId: lock?.id ?? null,
      targetName: lock?.name ?? '',
    });
  };
  target?.subscribe(publishLock);
  publishLock();
  const requireTarget = (): BleTarget => {
    if (!target) {
      throw new Error('Bluetooth picker is off');
    }
    return target;
  };
  const dropHid = () => {
    holder.ble.detach();
    holder.adapter?.close();
    holder.adapter = undefined;
    holder.hid?.close();
    holder.hid = undefined;
    holder.model = undefined;
    if (holder.hidState === 'up') {
      holder.hidState = 'idle';
    }
  };
  const onParentAbort = () => dropHid();
  parent.addEventListener('abort', onParentAbort);
  const runtime: ProxyRuntime = {
    start() {
      if (inFlight) {
        pendingStart = true;
        abort?.abort();
        pairing?.reset();
        return;
      }
      if (!nativeReady) {
        const message =
          'native-proxy is not built. Install Rust, then: yarn workspace @cws/native-proxy build';
        bus.patch({ phase: 'error', error: message, running: false });
        proxyLog(message);
        return;
      }
      inFlight = true;
      pendingStart = false;
      abort = new AbortController();
      const session = abort;
      const onParent = () => session.abort();
      parent.addEventListener('abort', onParent);
      bus.patch({ running: true, phase: 'scanning', error: null });
      proxyLog('start');
      loop = runProxy(io, proxyLog, session.signal, {
        ...options,
        bleTarget: target,
        persistHid: true,
        holder,
        status: bus,
        labSlot: {
          set(handle) {
            lab = handle;
            bus.patch({ labReady: Boolean(handle) });
          },
        },
      })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message === 'aborted') {
            return;
          }
          bus.patch({ phase: 'error', error: message });
          proxyLog(message);
        })
        .finally(() => {
          parent.removeEventListener('abort', onParent);
          pairing?.reset();
          abort = undefined;
          inFlight = false;
          lab = undefined;
          bus.idle();
          publishLock();
          if (pendingStart) {
            pendingStart = false;
            runtime.start();
          }
        });
    },
    stop() {
      pendingStart = false;
      abort?.abort();
      pairing?.reset();
      lab = undefined;
      if (inFlight) {
        proxyLog('stopping');
      }
      bus.idle();
      publishLock();
    },
    wait() {
      return loop;
    },
    busy() {
      return inFlight;
    },
    labCatalog(requested) {
      const snap = bus.snapshot();
      return labCatalogFor(snap.brand ?? requested ?? 'ledger', Boolean(lab), snap.brand);
    },
    async runLab(actionId, draft) {
      if (!lab) {
        throw new Error('Start the proxy and wait for GATT');
      }
      return lab.run(actionId, draft);
    },
    setOpenAppName(name) {
      const adapter = holder.adapter;
      if (!adapter) {
        throw new Error('HID adapter is not up');
      }
      adapter.setOpenAppName(name);
    },
    selectBle(id) {
      const trimmed = id.trim();
      if (!trimmed) {
        throw new Error('device id required');
      }
      const row = bus.snapshot().nearby.find((item) => item.id === trimmed);
      const current = requireTarget().snapshot().lock;
      requireTarget().select({
        id: trimmed,
        name: row?.name || (current?.id === trimmed ? current.name : trimmed),
        modelId: row?.modelId ?? (current?.id === trimmed ? current.modelId : null),
      });
    },
    unlockBle() {
      requireTarget().unlock();
    },
    rescanBle() {
      requireTarget().rescan();
    },
  };
  return runtime;
}
