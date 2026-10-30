import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple } from './generic';

/**
 * CLA/INS from LedgerHQ/app-canton `doc/APDU.md` (CLA 0xE0).
 * MATCH: GET_VERSION (INS 03) is major, minor, patch.
 * KEEP: GET_APP_NAME, GET_PUBLIC_KEY, SIGN_TX.
 */
export async function handleCantonApdu(apdu: Apdu) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x03) {
    return encodeResponse(versionTriple(catalogVersion('canton', '3.5.1')), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
