import type { Brand } from './index';

export type SigningKind =
  | 'sign'
  | 'address'
  | 'verify'
  | 'allow-manager'
  | 'pairing'
  | 'open-app';

export interface SigningRequest {
  brand: Brand;
  kind: SigningKind;
  title: string;
  path: string;
  message: string;
  rawPayload: Uint8Array;
}

export function signingNeedsPassphrase(kind: SigningKind): boolean {
  return kind === 'sign' || kind === 'address';
}

export function signingSlideLabel(kind: SigningKind): string {
  switch (kind) {
    case 'address':
      return 'Slide to export';
    case 'verify':
      return 'Slide to verify';
    case 'allow-manager':
      return 'Slide to allow';
    case 'pairing':
      return 'Slide to pair';
    case 'open-app':
      return 'Slide to open';
    default:
      return 'Slide to sign';
  }
}

export const SLIDE_COMMIT_RATIO = 0.85;

export function slideProgress(translationX: number, travel: number): number {
  if (travel <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, translationX / travel));
}

export function shouldCommitSlide(progress: number): boolean {
  return progress >= SLIDE_COMMIT_RATIO;
}
