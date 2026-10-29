import { describe, expect, it } from 'vitest';
import { revealNeedsOsReauth } from './revealPolicy';

describe('revealNeedsOsReauth', () => {
  it('requires the OS authenticator on release before a seed is revealed', () => {
    expect(revealNeedsOsReauth(false)).toBe(true);
  });

  it('lets a debug build reveal without a second OS prompt', () => {
    expect(revealNeedsOsReauth(true)).toBe(false);
  });
});
