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
 * CLA/INS from LedgerHQ/app-solar `doc/COMMANDS.md`.
 * MATCH: GET_VERSION is CLA 0xE0 INS 0xA2, three version bytes.
 * KEEP: GET_APP_NAME, GET_PUBLIC_KEY, GET_ADDRESS, SIGN_MESSAGE, SIGN_TX.
 */
export async function handleSolarApdu(apdu: Apdu) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0xa2) {
    return encodeResponse(versionTriple(catalogVersion('solar', '1.3.1')), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
