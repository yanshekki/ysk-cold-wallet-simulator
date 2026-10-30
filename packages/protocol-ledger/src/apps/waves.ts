import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type WavesSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-waves `src/main.h` + `main.c` (CLA 0x80).
 * MATCH: GET_APP_CONFIGURATION maj||min||patch (3-byte only).
 * KEEP: GET_PUBLIC_KEY / SIGN — Curve25519 (not SLIP-10 ed25519) + stream EdDSA.
 */
export async function handleWavesApdu(apdu: Apdu, _ctx: FamilyContext, _session: WavesSession) {
  if (apdu.cla !== 0x80) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x06) {
    return encodeResponse(versionTriple(catalogVersion('waves', '1.2.2')), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
