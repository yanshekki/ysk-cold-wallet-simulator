export const WALLET_PREP_TIMEOUT_MS = 20_000;

export class WalletPrepTimeoutError extends Error {
  readonly key = 'common.preparingWalletTimeout' as const;

  constructor() {
    super('common.preparingWalletTimeout');
    this.name = 'WalletPrepTimeoutError';
  }
}

export function isWalletPrepTimeout(error: unknown): error is WalletPrepTimeoutError {
  return error instanceof WalletPrepTimeoutError || (error instanceof Error && error.name === 'WalletPrepTimeoutError');
}

export async function yieldOverlayPaint(): Promise<void> {
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: (time: number) => void) => setTimeout(() => cb(0), 0);
  await new Promise<void>((resolve) => {
    raf(() => {
      raf(() => resolve());
    });
  });
}

export type WalletPrepOk<T> = { status: 'ok'; value: T };
export type WalletPrepTimeout = { status: 'timeout' };
export type WalletPrepResult<T> = WalletPrepOk<T> | WalletPrepTimeout;

/**
 * Show a loading overlay, let it paint, then run work (which may include OS
 * auth). A ~20s watchdog hides the overlay without skipping authentication.
 */
export async function runWalletPrep<T>(options: {
  show: () => void;
  hide: () => void;
  work: (signal: AbortSignal) => Promise<T>;
  yieldPaint?: () => Promise<void>;
  timeoutMs?: number;
}): Promise<WalletPrepResult<T>> {
  const yieldPaint = options.yieldPaint ?? yieldOverlayPaint;
  const timeoutMs = options.timeoutMs ?? WALLET_PREP_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let settled = false;

  options.show();
  await yieldPaint();

  return await new Promise<WalletPrepResult<T>>((resolve, reject) => {
    const finish = (result: WalletPrepResult<T>) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      options.hide();
      finish({ status: 'timeout' });
    }, timeoutMs);

    void options
      .work(controller.signal)
      .then((value) => {
        clearTimeout(timer);
        if (timedOut) {
          return;
        }
        options.hide();
        finish({ status: 'ok', value });
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        if (timedOut) {
          return;
        }
        options.hide();
        fail(error);
      });
  });
}
