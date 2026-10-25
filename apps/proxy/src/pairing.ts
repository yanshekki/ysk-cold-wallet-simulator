export type PairingGate = {
  wait(signal?: AbortSignal): Promise<string>;
  submit(code: string): void;
  reset(): void;
};

export function createPairingGate(): PairingGate {
  let pending: ((code: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;

  function clear(): void {
    pending = undefined;
    fail = undefined;
  }

  return {
    wait(signal) {
      if (signal?.aborted) {
        return Promise.reject(new Error('pairing cancelled'));
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          clear();
          signal?.removeEventListener('abort', onAbort);
          reject(new Error('pairing cancelled'));
        };
        pending = (code) => {
          signal?.removeEventListener('abort', onAbort);
          clear();
          resolve(code);
        };
        fail = () => onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    submit(code: string) {
      const digits = code.replace(/\D/g, '');
      pending?.(digits);
      clear();
    },
    reset() {
      fail?.(new Error('pairing cancelled'));
      clear();
    },
  };
}
