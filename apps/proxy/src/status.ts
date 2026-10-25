import type { Brand } from '@cws/contracts';

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
  trezord: string | null;
  error: string | null;
  pairing: boolean;
  nativeOk: boolean;
  logs: LogLine[];
};

export type StatusPatch = Partial<Omit<ProxyStatus, 'radio' | 'logs'>>;

const LOG_CAP = 200;

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
    trezord: null,
    error: null,
    pairing: false,
    nativeOk,
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
      logs.unshift({ id: String(seq), at: Date.now(), line });
      if (logs.length > LOG_CAP) {
        logs.length = LOG_CAP;
      }
      emit();
    },
    idle() {
      const keepNative = state.nativeOk;
      state = emptyState(keepNative);
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
