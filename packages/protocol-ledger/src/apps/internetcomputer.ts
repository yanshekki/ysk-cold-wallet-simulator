import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type InternetComputerSession = FamilySession;

/**
 * CLA/INS from Zondax/ledger-icp `docs/APDUSPEC.md` + `app/src/coin.h` (CLA 0x11).
 * MATCH: GET_VERSION test||maj||min||patch||locked (5-byte Zondax).
 * KEEP: GET_ADDR / SIGN / SIGN_COMBINED / consent / canister / certificate / tokens.
 */
export async function handleInternetComputerApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0x11) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    const version = versionTriple(catalogVersion('internetcomputer', '4.2.17'));
    return encodeResponse(Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!, 0x00), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
