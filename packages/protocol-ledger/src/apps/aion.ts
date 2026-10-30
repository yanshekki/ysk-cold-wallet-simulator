import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type AionSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-aion `src/main.c` (CLA 0xE0).
 * MATCH: GET_APP_CONFIGURATION flags||maj||min||patch (4-byte).
 * KEEP: GET_PUBLIC_KEY / SIGN / SIGN_PERSONAL_MESSAGE (Aion address + tx layout).
 */
export async function handleAionApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x06) {
    const version = versionTriple(catalogVersion('aion', '1.0.4'));
    return encodeResponse(Uint8Array.of(0x01, version[0]!, version[1]!, version[2]!), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
