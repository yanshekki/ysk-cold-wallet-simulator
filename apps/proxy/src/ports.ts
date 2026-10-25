export type Unsubscribe = () => void;

export type HidPort = {
  write(report: Uint8Array): void;
  onInput(callback: (report: Uint8Array) => void): Unsubscribe;
  close(): void;
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
};
