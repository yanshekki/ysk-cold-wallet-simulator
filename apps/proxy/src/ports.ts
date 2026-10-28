import type { DeviceModel } from '@cws/contracts';

export type Unsubscribe = () => void;

export type HidPort = {
  write(report: Uint8Array): void;
  onInput(callback: (report: Uint8Array) => void): Unsubscribe;
  close(): void;
  switchModel?(model: DeviceModel): Promise<void>;
};

export type BlePort = {
  write(packet: Uint8Array): Promise<void>;
  onNotify(callback: (packet: Uint8Array) => void): Unsubscribe;
  close(): Promise<void>;
};

export type ProtocolHandlerPort = {
  handleWrite(data: Uint8Array): Promise<Uint8Array | null>;
};

function copy(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

export function memoryHidPair(): { host: HidPort; gadget: HidPort } {
  const hostListeners: Array<(report: Uint8Array) => void> = [];
  const gadgetListeners: Array<(report: Uint8Array) => void> = [];
  const host: HidPort = {
    write(report) {
      for (const listener of gadgetListeners) {
        listener(copy(report));
      }
    },
    onInput(callback) {
      hostListeners.push(callback);
      return () => {
        const index = hostListeners.indexOf(callback);
        if (index >= 0) {
          hostListeners.splice(index, 1);
        }
      };
    },
    close() {
      hostListeners.length = 0;
    },
  };
  const gadget: HidPort = {
    write(report) {
      for (const listener of hostListeners) {
        listener(copy(report));
      }
    },
    onInput(callback) {
      gadgetListeners.push(callback);
      return () => {
        const index = gadgetListeners.indexOf(callback);
        if (index >= 0) {
          gadgetListeners.splice(index, 1);
        }
      };
    },
    close() {
      gadgetListeners.length = 0;
    },
  };
  return { host, gadget };
}

export function bleToHandler(
  handler: ProtocolHandlerPort,
  split: (framed: Uint8Array) => Uint8Array[],
): BlePort {
  const listeners: Array<(packet: Uint8Array) => void> = [];
  return {
    async write(packet) {
      const framed = await handler.handleWrite(packet);
      if (!framed) {
        return;
      }
      for (const piece of split(framed)) {
        for (const listener of listeners) {
          listener(copy(piece));
        }
      }
    },
    onNotify(callback) {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    async close() {
      listeners.length = 0;
    },
  };
}

export type WriteQueue = {
  push(task: () => Promise<void>): void;
  idle(): Promise<void>;
  abort(): void;
};

export function serializeWrites(onError?: (error: unknown) => void): WriteQueue {
  let queue = Promise.resolve();
  let aborted = false;
  return {
    push(task) {
      if (aborted) {
        return;
      }
      queue = queue
        .then(() => (aborted ? undefined : task()))
        .catch((error) => {
          if (!aborted) {
            onError?.(error);
          }
        });
    },
    idle() {
      return queue;
    },
    abort() {
      aborted = true;
    },
  };
}

export type AdapterHandle = {
  close(): void;
  idle(): Promise<void>;
  setLabAwaiting(active: boolean): void;
  /** Keep WebHID GET_APP_AND_VERSION cache in sync (lab OpenApp / phone Select app). */
  setOpenAppName(name: string): void;
};

export type ExclusiveLock = {
  run<T>(task: () => Promise<T>): Promise<T>;
};

export type ConnectedBleLike = BlePort & {
  isConnected(): Promise<boolean>;
  debugInfo?: () => string;
};

export function createDeferredBle(): {
  port: ConnectedBleLike;
  attach(ble: ConnectedBleLike): void;
  detach(): void;
} {
  let inner: ConnectedBleLike | undefined;
  let offNotify: Unsubscribe | undefined;
  let waiters: Array<{
    resolve: (ble: ConnectedBleLike) => void;
    reject: (error: Error) => void;
  }> = [];
  const listeners: Array<(packet: Uint8Array) => void> = [];

  function connected(): Promise<ConnectedBleLike> {
    if (inner) {
      return Promise.resolve(inner);
    }
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }

  return {
    port: {
      async write(packet) {
        const ble = await connected();
        await ble.write(packet);
      },
      onNotify(callback) {
        listeners.push(callback);
        return () => {
          const index = listeners.indexOf(callback);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
      async close() {
        return;
      },
      isConnected() {
        return inner?.isConnected() ?? Promise.resolve(false);
      },
      debugInfo() {
        return inner?.debugInfo?.() ?? 'deferred';
      },
    },
    attach(ble) {
      offNotify?.();
      inner = ble;
      offNotify = ble.onNotify((packet) => {
        for (const listener of listeners) {
          listener(packet);
        }
      });
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) {
        waiter.resolve(ble);
      }
    },
    detach() {
      offNotify?.();
      offNotify = undefined;
      inner = undefined;
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) {
        waiter.reject(new Error('ble detached'));
      }
    },
  };
}

export function createExclusive(): ExclusiveLock {
  let tail = Promise.resolve();
  return {
    run(task) {
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

export type NotifyRouter = {
  dispatch(packet: Uint8Array): void;
  subscribe(callback: (packet: Uint8Array) => void): Unsubscribe;
  hijack(callback: (packet: Uint8Array) => void): Unsubscribe;
};

export function createNotifyRouter(): NotifyRouter {
  const listeners = new Set<(packet: Uint8Array) => void>();
  let hijacked: ((packet: Uint8Array) => void) | undefined;
  return {
    dispatch(packet) {
      const dest = hijacked;
      if (dest) {
        dest(packet);
        return;
      }
      for (const listener of listeners) {
        listener(packet);
      }
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    hijack(callback) {
      if (hijacked) {
        throw new Error('lab already in flight');
      }
      hijacked = callback;
      return () => {
        if (hijacked === callback) {
          hijacked = undefined;
        }
      };
    },
  };
}
