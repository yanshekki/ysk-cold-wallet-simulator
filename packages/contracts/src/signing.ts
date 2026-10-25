import type { Brand } from './index';
import type { SigningDetail } from './signingPreview';

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
  detail?: SigningDetail;
}

export function signingNeedsPassphrase(kind: SigningKind): boolean {
  return kind === 'sign' || kind === 'address';
}

export function signingSlideLabel(kind: SigningKind): string {
  switch (kind) {
    case 'address':
      return 'signing.slideExport';
    case 'verify':
      return 'signing.slideVerify';
    case 'allow-manager':
      return 'signing.slideAllow';
    case 'pairing':
      return 'signing.slidePair';
    case 'open-app':
      return 'signing.slideOpen';
    default:
      return 'signing.slideSign';
  }
}

export const SLIDE_COMMIT_RATIO = 0.5;

export function slideProgress(translationX: number, travel: number): number {
  if (travel <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, translationX / travel));
}

export function shouldCommitSlide(progress: number): boolean {
  return progress >= SLIDE_COMMIT_RATIO;
}
