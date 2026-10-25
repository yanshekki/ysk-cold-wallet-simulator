import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

const INFO = new TextEncoder().encode('cws-seed-v1');

/** Mix optional motion/timing into CSPRNG output. Extra is never used alone. */
export function mixExtraEntropy(csprng: Uint8Array, extra: Uint8Array): Uint8Array {
  if (extra.length === 0) {
    return csprng;
  }
  return hkdf(sha256, csprng, extra, INFO, csprng.length);
}
