import { describe, expect, it } from 'vitest';
import { ALL_MODELS, bleAdvertiseName } from './models';

describe('bleAdvertiseName', () => {
  it('keeps OneKey names short enough for an iOS ADV packet', () => {
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'classic')!)).toBe('K1234');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'classic1s')!)).toBe('1S A1B2');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'pure')!)).toBe('P1234');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'touch')!)).toBe('T1234');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'pro')!)).toBe('Pro A1B2');
  });

  it('uses short Ledger local names instead of the full product title', () => {
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'nano-x')!)).toBe('Nano X');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'flex')!)).toBe('Flex');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'stax')!)).toBe('Stax');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'gen5')!)).toBe('Nano G5');
  });
});
