import { describe, expect, it } from 'vitest';
import { mixExtraEntropy } from './mixEntropy';

describe('mixExtraEntropy', () => {
  it('keeps CSPRNG length and changes output when extra is present', () => {
    const csprng = new Uint8Array(16).map((_, i) => i + 1);
    const mixed = mixExtraEntropy(csprng, new Uint8Array([9, 8, 7]));
    expect(mixed.length).toBe(16);
    expect(Array.from(mixed)).not.toEqual(Array.from(csprng));
  });

  it('returns the CSPRNG bytes when extra is empty', () => {
    const csprng = new Uint8Array(16).map((_, i) => i + 1);
    expect(Array.from(mixExtraEntropy(csprng, new Uint8Array()))).toEqual(Array.from(csprng));
  });
});
