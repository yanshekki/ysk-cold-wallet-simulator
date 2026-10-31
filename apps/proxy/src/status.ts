import type { Brand } from '@cws/contracts';
import type { NearbyDevice } from './bleLock';

export type ProxyPhase = 'idle' | 'scanning' | 'connecting' | 'gatt' | 'hid' | 'error';
export type HidState = 'idle' | 'up' | 'skipped' | 'failed';
export type RadioMode = 'IDLE' | 'SCAN' | 'GATT' | 'HID';

export type LogLine = {
  id: string;
  at: number;
  line: string;
};

export type ProxyStatus = {
  running: boolean;
  phase: ProxyPhase;
  radio: RadioMode;
  phoneName: string;
  brand: Brand | null;
  modelId: string | null;
  modelName: string | null;
  protocol: string | null;
  serviceUUID: string | null;
  vendorId: number | null;
  productId: number | null;
  mtu: number | null;
  hid: HidState;
  hidError: string | null;
  labReady: boolean;
  trezord: string | null;
  error: string | null;
  pairing: boolean;
  nativeOk: boolean;
  /** Compatible advertisers from the latest scan. Empty when the proxy is idle. */
  nearby: NearbyDevice[];
  /** OS Bluetooth id the user locked, or null when the picker is waiting. */
  targetId: string | null;
  targetName: string;
  locked: boolean;
  logs: LogLine[];
};

export type StatusPatch = Partial<Omit<ProxyStatus, 'radio' | 'logs'>>;

const LOG_CAP = 200;

/**
 * Proxy is transport-only. It does not store a seed. Logs must not keep a
 * mnemonic or a long hex secret if a caller passes one by mistake.
 */
export function redactSecrets(line: string): string {
  const words = line.trim().split(/\s+/);
  const mnemonicLike = words.length >= 12 && words.every((word) => /^[a-z]+$/i.test(word));
  if (mnemonicLike) {
    return '[redacted]';
  }
  return line.replace(/\b[0-9a-f]{64,}\b/gi, '[redacted]');
}

function radioFor(state: Omit<ProxyStatus, 'radio' | 'logs'>): RadioMode {
  if (!state.running) {
    return 'IDLE';
  }
  if (state.hid === 'up') {
    return 'HID';
  }
  if (state.phase === 'scanning' || state.phase === 'connecting') {
    return 'SCAN';
  }
  if (state.phase === 'gatt' || state.phase === 'hid' || state.hid === 'failed' || state.hid === 'skipped') {
    return 'GATT';
  }
  return 'IDLE';
}

function emptyState(nativeOk = true): Omit<ProxyStatus, 'radio' | 'logs'> {
  return {
    running: false,
    phase: 'idle',
    phoneName: '',
    brand: null,
    modelId: null,
    modelName: null,
    protocol: null,
    serviceUUID: null,
    vendorId: null,
    productId: null,
    mtu: null,
    hid: 'idle',
    hidError: null,
    labReady: false,
    trezord: null,
    error: null,
    pairing: false,
    nativeOk,
    nearby: [],
    targetId: null,
    targetName: '',
    locked: false,
  };
}

export type StatusSink = {
  patch(partial: StatusPatch): void;
  log(line: string): void;
};

export type StatusBus = StatusSink & {
  snapshot(): ProxyStatus;
  idle(): void;
  clearLogs(): void;
  subscribe(listener: (status: ProxyStatus) => void): () => void;
};

export function createStatusBus(nativeOk = true): StatusBus {
  let state = emptyState(nativeOk);
  const logs: LogLine[] = [];
  const listeners = new Set<(status: ProxyStatus) => void>();
  let seq = 0;

  function emit(): void {
    const status = snapshot();
    for (const listener of listeners) {
      listener(status);
    }
  }

  function snapshot(): ProxyStatus {
    return {
      ...state,
      radio: radioFor(state),
      logs: logs.slice(),
    };
  }

  return {
    snapshot,
    patch(partial) {
      state = { ...state, ...partial };
      emit();
    },
    log(line) {
      seq += 1;
      logs.unshift({ id: String(seq), at: Date.now(), line: redactSecrets(line) });
      if (logs.length > LOG_CAP) {
        logs.length = LOG_CAP;
      }
      emit();
    },
    idle() {
      const keepNative = state.nativeOk;
      const keepHid =
        state.hid === 'up'
          ? {
              hid: 'up' as const,
              hidError: null,
              vendorId: state.vendorId,
              productId: state.productId,
              brand: state.brand,
              modelId: state.modelId,
              modelName: state.modelName,
            }
          : undefined;
      state = { ...emptyState(keepNative), ...keepHid };
      emit();
    },
    clearLogs() {
      logs.length = 0;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
