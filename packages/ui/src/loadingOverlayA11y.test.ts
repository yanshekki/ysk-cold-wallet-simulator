import { describe, expect, it } from 'vitest';
import { loadingOverlayA11y, overlayShowsAnimatedSpinner } from './loadingOverlayA11y';

describe('loading overlay accessibility', () => {
  it('exposes a progressbar that announces the preparing copy, not a secret', () => {
    const a11y = loadingOverlayA11y('Preparing wallet…');
    expect(a11y.accessibilityViewIsModal).toBe(true);
    expect(a11y.accessibilityRole).toBe('progressbar');
    expect(a11y.accessibilityLiveRegion).toBe('polite');
    expect(a11y.accessibilityLabel).toBe('Preparing wallet…');
    expect(a11y.accessibilityLabel).not.toMatch(/fingerprint|mnemonic|passphrase|seed/i);
  });

  it('keeps the spinner static when Reduce Motion is on', () => {
    expect(overlayShowsAnimatedSpinner(false)).toBe(true);
    expect(overlayShowsAnimatedSpinner(true)).toBe(false);
  });
});
