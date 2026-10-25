import { runProxy, type ProxyIo, type ProxyOptions } from './daemon';
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
};

export function teeLog(log: LogFn, bus: StatusBus): LogFn {
  return (line) => {
    log(line);
    bus.log(line);
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
  const nativeReady = options.nativeReady ?? true;
  const proxyLog = teeLog(log, bus);
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
      loop = runProxy(io, proxyLog, session.signal, { ...options, status: bus })
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
  };
  return runtime;
}
