import type { Brand } from './index';
import type { SigningDetail } from './signingPreview';

export type SigningKind =
  | 'sign'
  | 'address'
  | 'verify'
  | 'allow-manager'
  | 'pairing'
  | 'open-app'
  | 'export-seed';

export type PassphraseSource = 'none' | 'device' | 'host';

export interface SigningRequest {
  brand?: Brand;
  kind: SigningKind;
  title: string;
  path: string;
  message: string;
  rawPayload: Uint8Array;
  detail?: SigningDetail;
  /** Actual derivation overlay for this request. Host must not silently diverge from the UI chip. */
  passphraseSource?: PassphraseSource;
}

export function signingNeedsPassphrase(kind: SigningKind): boolean {
  return kind === 'sign' || kind === 'address' || kind === 'export-seed';
}

export function signingHoldLabel(kind: SigningKind): string {
  switch (kind) {
    case 'address':
      return 'signing.holdExport';
    case 'verify':
      return 'signing.holdVerify';
    case 'allow-manager':
      return 'signing.holdAllow';
    case 'pairing':
      return 'signing.holdPair';
    case 'open-app':
      return 'signing.holdOpen';
    case 'export-seed':
      return 'signing.holdExportSeed';
    default:
      return 'signing.holdSign';
  }
}

export const HOLD_CONFIRM_MIN_SECONDS = 1;
export const HOLD_CONFIRM_MAX_SECONDS = 10;
export const HOLD_CONFIRM_DEFAULT_SECONDS = 3;

export const HOLD_CONFIRM_SECONDS: readonly number[] = Array.from(
  { length: HOLD_CONFIRM_MAX_SECONDS - HOLD_CONFIRM_MIN_SECONDS + 1 },
  (_, i) => HOLD_CONFIRM_MIN_SECONDS + i,
);

export function clampHoldDuration(seconds: unknown): number {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n)) {
    return HOLD_CONFIRM_DEFAULT_SECONDS;
  }
  return Math.min(HOLD_CONFIRM_MAX_SECONDS, Math.max(HOLD_CONFIRM_MIN_SECONDS, Math.round(n)));
}

export function holdDurationMs(seconds: unknown): number {
  return clampHoldDuration(seconds) * 1000;
}

export function holdProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

export function shouldCommitHold(elapsedMs: number, durationMs: number): boolean {
  return holdProgress(elapsedMs, durationMs) >= 1;
}
