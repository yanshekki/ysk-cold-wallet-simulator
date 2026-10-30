import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { versionTriple } from './generic';

/**
 * CLA/INS from LedgerHQ/app-kaspa `src/constants.h` (CLA 0xE0) and `src/types.h`.
 * MATCH: GET_VERSION (INS 03) is major, minor, patch. P1 and P2 must be 0
 * (`src/apdu/dispatcher.c` returns SW_WRONG_P1P2).
 * KEEP: GET_APP_NAME, GET_PUBLIC_KEY, SIGN_TX, SIGN_MESSAGE (Schnorr / ECDSA).
 */
export async function handleKaspaApdu(apdu: Apdu) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x03) {
    if (apdu.p1 !== 0 || apdu.p2 !== 0) {
      return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
    }
    return encodeResponse(versionTriple(catalogVersion('kaspa', '1.2.2')), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
