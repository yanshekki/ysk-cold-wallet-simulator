import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type AleoSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-aleo `doc/APDU.md` + `src/types.h` / `src/constants.h` (CLA 0xE0).
 * MATCH: GET_VERSION maj||min||patch (3-byte).
 * KEEP: GET_ADDRESS / SIGN_TRANSACTION / GET_VIEW_KEY / GET_TVK.
 */
export async function handleAleoApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x03) {
    const version = versionTriple(catalogVersion('aleo', '1.4.0'));
    return encodeResponse(version, SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
