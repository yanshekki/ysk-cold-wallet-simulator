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
 * CLA from LedgerHQ/app-nervos `src/apdu.c` (`#define CLA 0x80`).
 * INS_VERSION 0x00 from `src/apdu.h`. Body is `version_t` {major, minor, patch}.
 * KEEP: wallet id, public key, sign, sign-message.
 */
export async function handleNervosApdu(apdu: Apdu) {
  if (apdu.cla !== 0x80) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(versionTriple(catalogVersion('nervos', '0.6.3')), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
