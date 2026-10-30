import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type ErgoSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-ergo `doc/APDU.md` + `src/apdu_dispatcher.h` / `src/commands/app_version.c` (CLA 0xE0).
 * MATCH: GET_APP_VERSION maj||min||patch||debug (4-byte; debug=0 production).
 * KEEP: GET_EXTENDED_PUBLIC_KEY / DERIVE_ADDRESS / ATTEST_INPUT_BOX / SIGN_TRANSACTION.
 */
export async function handleErgoApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    const version = versionTriple(catalogVersion('ergo', '0.0.10'));
    return encodeResponse(Uint8Array.of(version[0]!, version[1]!, version[2]!, 0x00), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
