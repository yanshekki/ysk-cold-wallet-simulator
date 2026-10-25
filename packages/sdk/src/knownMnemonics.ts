import { normalizeWords } from './entropy';

/** Public fixtures that must never go on BLE radio. Tests may still use them in vitest. */
export const KNOWN_UNSAFE_MNEMONICS = [
  'test test test test test test test test test test test junk',
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
  'all all all all all all all all all all all all',
] as const;

export function isKnownUnsafeMnemonic(mnemonic: string): boolean {
  const normalized = normalizeWords(mnemonic);
  return KNOWN_UNSAFE_MNEMONICS.some((item) => item === normalized);
}
