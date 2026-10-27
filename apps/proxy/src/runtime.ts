import { createHidHolder, runProxy, type HidHolder, type ProxyIo, type ProxyOptions } from './daemon';
import { labCatalogFor, type LabCatalog, type LabDraftInput, type LabHandle } from './lab';
import type { LogFn } from './log';
import type { PairingGate } from './pairing';
import type { StatusBus } from './status';

export type RuntimeOptions = Omit<ProxyOptions, 'status'> & {
  nativeReady?: boolean;
};

export type ProxyRuntime = {
  start(): void;
  stop(): void;
  wait(): Promise<void>;
  busy(): boolean;
  labCatalog(): LabCatalog;
  runLab(actionId: string, draft?: LabDraftInput): Promise<string>;
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
    },
    wait() {
      return loop;
    },
    busy() {
      return inFlight;
    },
    labCatalog() {
      const snap = bus.snapshot();
      return labCatalogFor(snap.brand, Boolean(lab));
    },
    async runLab(actionId, draft) {
      if (!lab) {
        throw new Error('Start the proxy and wait for GATT');
      }
      return lab.run(actionId, draft);
    },
  };
  return runtime;
}
