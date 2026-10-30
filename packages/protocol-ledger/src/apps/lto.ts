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
 * CLA/INS from LedgerHQ/app-lto `src/main.h`.
 * MATCH: INS_GET_APP_CONFIGURATION (0x06) is major, minor, patch
 * (`set_result_get_app_configuration` in `src/main.c`).
 * KEEP: INS_SIGN and INS_GET_PUBLIC_KEY.
 */
export async function handleLtoApdu(apdu: Apdu) {
  if (apdu.cla !== 0x80) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x06) {
    return encodeResponse(versionTriple(catalogVersion('lto-network', '2.2.3')), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
