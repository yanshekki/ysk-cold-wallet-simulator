import { describe, expect, it } from 'vitest';
import {
  SLIDE_COMMIT_RATIO,
  shouldCommitSlide,
  signingNeedsPassphrase,
  signingSlideLabel,
  slideProgress,
} from './signing';

describe('slide-to-confirm math', () => {
  it('commits once the thumb is past 50% of travel', () => {
    expect(SLIDE_COMMIT_RATIO).toBe(0.5);
    expect(shouldCommitSlide(0.49)).toBe(false);
    expect(shouldCommitSlide(0.5)).toBe(true);
    expect(shouldCommitSlide(1)).toBe(true);
  });

  it('clamps progress to the track', () => {
    expect(slideProgress(-10, 100)).toBe(0);
    expect(slideProgress(40, 100)).toBe(0.4);
    expect(slideProgress(200, 100)).toBe(1);
    expect(slideProgress(10, 0)).toBe(0);
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

  it('labels the bar from kind', () => {
    expect(signingSlideLabel('sign')).toBe('signing.slideSign');
    expect(signingSlideLabel('verify')).toBe('signing.slideVerify');
    expect(signingSlideLabel('address')).toBe('signing.slideExport');
    expect(signingSlideLabel('allow-manager')).toBe('signing.slideAllow');
    expect(signingSlideLabel('open-app')).toBe('signing.slideOpen');
    expect(signingSlideLabel('pairing')).toBe('signing.slidePair');
    expect(signingSlideLabel('export-seed')).toBe('signing.slideExportSeed');
  });
});
