import { afterEach, describe, expect, it, vi } from 'vitest';
import { WALLET_PREP_TIMEOUT_MS, runWalletPrep } from './walletPrep';

describe('runWalletPrep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the overlay and yields before work (including OS auth) starts', async () => {
    const events: string[] = [];
    const result = await runWalletPrep({
      show: () => events.push('show'),
      hide: () => events.push('hide'),
      yieldPaint: async () => {
        events.push('yield');
      },
      work: async () => {
        events.push('auth');
        events.push('work');
        return 'ok';
      },
    });
    expect(events).toEqual(['show', 'yield', 'auth', 'work', 'hide']);
    expect(result).toEqual({ status: 'ok', value: 'ok' });
  });

  it('hides the overlay on timeout without waiting for work to finish', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let resume: ((value: boolean) => void) | undefined;
    const pending = runWalletPrep({
      show: () => events.push('show'),
      hide: () => events.push('hide'),
      yieldPaint: async () => {
        events.push('yield');
      },
      timeoutMs: WALLET_PREP_TIMEOUT_MS,
      work: () =>
        new Promise<boolean>((resolve) => {
          events.push('auth');
          resume = resolve;
        }),
    });
    await Promise.resolve();
    expect(events).toEqual(['show', 'yield', 'auth']);
    await vi.advanceTimersByTimeAsync(WALLET_PREP_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ status: 'timeout' });
    expect(events).toEqual(['show', 'yield', 'auth', 'hide']);
    resume?.(true);
  });

  it('does not apply work after the watchdog has already hidden the overlay', async () => {
    vi.useFakeTimers();
    let ranWork = false;
    let finishAuth: ((value: boolean) => void) | undefined;
    const pending = runWalletPrep({
      show: () => undefined,
      hide: () => undefined,
      yieldPaint: async () => undefined,
      timeoutMs: 50,
      work: async (signal) => {
        await new Promise<boolean>((resolve) => {
          finishAuth = resolve;
        });
        if (signal.aborted) {
          return 'skipped';
        }
        ranWork = true;
        return 'applied';
      },
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({ status: 'timeout' });
    finishAuth?.(true);
    await Promise.resolve();
    expect(ranWork).toBe(false);
  });

  it('hides the overlay when work throws', async () => {
    const hide = vi.fn();
    await expect(
      runWalletPrep({
        show: () => undefined,
        hide,
        yieldPaint: async () => undefined,
        work: async () => {
          throw new Error('errors.passphraseFailed');
        },
      }),
    ).rejects.toThrow('errors.passphraseFailed');
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
