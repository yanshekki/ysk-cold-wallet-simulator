import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type EverscaleSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-everscale `src/apdu_constants.h` + get_app_configuration handler (CLA 0xE0).
 * MATCH: GET_APP_CONFIGURATION maj||min||patch (3-byte).
 * KEEP: GET_PUBLIC_KEY / SIGN / GET_ADDRESS / SIGN_TRANSACTION.
 */
export async function handleEverscaleApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    const version = versionTriple(catalogVersion('everscale', '1.1.8'));
    return encodeResponse(version, SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
