import { describe, expect, it } from 'vitest';
import {
  SLIDE_COMMIT_RATIO,
  shouldCommitSlide,
  signingNeedsPassphrase,
  signingSlideLabel,
  slideProgress,
} from './signing';

describe('slide-to-confirm math', () => {
  it('commits only at 85% of travel', () => {
    expect(SLIDE_COMMIT_RATIO).toBe(0.85);
    expect(shouldCommitSlide(0.84)).toBe(false);
    expect(shouldCommitSlide(0.85)).toBe(true);
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
  });

  it('labels the bar from kind', () => {
    expect(signingSlideLabel('sign')).toBe('Slide to sign');
    expect(signingSlideLabel('verify')).toBe('Slide to verify');
    expect(signingSlideLabel('address')).toBe('Slide to export');
    expect(signingSlideLabel('allow-manager')).toBe('Slide to allow');
    expect(signingSlideLabel('open-app')).toBe('Slide to open');
    expect(signingSlideLabel('pairing')).toBe('Slide to pair');
  });
});
