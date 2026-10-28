import { describe, expect, it } from 'vitest';
import {
  HOLD_CONFIRM_DEFAULT_SECONDS,
  HOLD_CONFIRM_MAX_SECONDS,
  HOLD_CONFIRM_MIN_SECONDS,
  HOLD_CONFIRM_SECONDS,
  clampHoldDuration,
  holdDurationMs,
  holdProgress,
  shouldCommitHold,
  signingHoldLabel,
  signingNeedsPassphrase,
} from './signing';

describe('hold-to-confirm math', () => {
  it('defaults to 3 seconds and stays within 3–10', () => {
    expect(HOLD_CONFIRM_DEFAULT_SECONDS).toBe(3);
    expect(HOLD_CONFIRM_MIN_SECONDS).toBe(3);
    expect(HOLD_CONFIRM_MAX_SECONDS).toBe(10);
    expect(HOLD_CONFIRM_SECONDS).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(clampHoldDuration(undefined)).toBe(3);
    expect(clampHoldDuration('nope')).toBe(3);
    expect(clampHoldDuration(0)).toBe(3);
    expect(clampHoldDuration(1)).toBe(3);
    expect(clampHoldDuration(2)).toBe(3);
    expect(clampHoldDuration(3.2)).toBe(3);
    expect(clampHoldDuration(3.7)).toBe(4);
    expect(clampHoldDuration(99)).toBe(10);
    expect(holdDurationMs(3)).toBe(3000);
    expect(holdDurationMs(-4)).toBe(3000);
  });

  it('commits only after the full duration', () => {
    expect(holdProgress(-10, 3000)).toBe(0);
    expect(holdProgress(1500, 3000)).toBe(0.5);
    expect(holdProgress(3000, 3000)).toBe(1);
    expect(holdProgress(4000, 3000)).toBe(1);
    expect(holdProgress(10, 0)).toBe(1);
    expect(shouldCommitHold(2999, 3000)).toBe(false);
    expect(shouldCommitHold(3000, 3000)).toBe(true);
  });

  it('hides passphrase except for sign and address', () => {
    expect(signingNeedsPassphrase('sign')).toBe(true);
    expect(signingNeedsPassphrase('address')).toBe(true);
    expect(signingNeedsPassphrase('verify')).toBe(false);
    expect(signingNeedsPassphrase('allow-manager')).toBe(false);
    expect(signingNeedsPassphrase('pairing')).toBe(false);
    expect(signingNeedsPassphrase('open-app')).toBe(false);
    expect(signingNeedsPassphrase('export-seed')).toBe(true);
  });

  it('labels the hold control from kind', () => {
    expect(signingHoldLabel('sign')).toBe('signing.holdSign');
    expect(signingHoldLabel('verify')).toBe('signing.holdVerify');
    expect(signingHoldLabel('address')).toBe('signing.holdExport');
    expect(signingHoldLabel('allow-manager')).toBe('signing.holdAllow');
    expect(signingHoldLabel('open-app')).toBe('signing.holdOpen');
    expect(signingHoldLabel('pairing')).toBe('signing.holdPair');
    expect(signingHoldLabel('export-seed')).toBe('signing.holdExportSeed');
  });
});
