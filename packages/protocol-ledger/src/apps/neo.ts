import {
  encodeResponse,
  pathToString,
  SW_CLA_NOT_SUPPORTED,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  type Apdu,
} from '../apdu';
import {
  deriveP256PrivateKeyFromSeed,
  publicKeyP256Uncompressed,
  seedFor,
} from '../crypto';
import type { FamilyContext, FamilySession } from './generic';

export type NeoSession = FamilySession;

const BIP44_BYTES = 20;

/**
 * CLA/INS from LedgerHQ/app-neo `src/main.c` (CLA 0x80). Same INS table for NEO N3 catalog sibling.
 * MATCH: GET_PUBLIC_KEY → 65-byte uncompressed P-256 (CX_CURVE_256R1 BIP32).
 * KEEP: SIGN (tx stream parse) / GET_SIGNED_PUBLIC_KEY (pub||0xFFFF||DER).
 */
export async function handleNeoApdu(apdu: Apdu, ctx: FamilyContext, _session: NeoSession) {
  if (apdu.cla !== 0x80) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x04) {
    if (apdu.data.length < BIP44_BYTES) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const components: number[] = [];
    for (let i = 0; i < 5; i++) {
      const o = i * 4;
      components.push(
        ((apdu.data[o]! << 24) | (apdu.data[o + 1]! << 16) | (apdu.data[o + 2]! << 8) | apdu.data[o + 3]!) >>> 0,
      );
    }
    const path = pathToString(components);
    if (apdu.p1 !== 0x00) {
      const ok = await ctx.confirmation.confirm({
        brand: 'ledger',
        kind: 'address',
        title: 'Export NEO public key',
        path,
        message: `Export NEO public key\n${path}`,
        rawPayload: apdu.data,
      });
      if (!ok) {
        return encodeResponse(new Uint8Array(), SW_DENY);
      }
    }
    const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
    const publicKey = publicKeyP256Uncompressed(deriveP256PrivateKeyFromSeed(seed, path));
    return encodeResponse(publicKey, SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
