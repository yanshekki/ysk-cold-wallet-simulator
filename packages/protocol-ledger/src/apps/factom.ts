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
 * CLA/INS from LedgerHQ/app-factom `src/main.c`.
 * MATCH: GET_APP_CONFIGURATION (INS 06) is
 * `[chain id set ? 1 : 0, major, minor, major]`.
 * CWS stores no Factom chain id, so the flag is 0. The last byte is major
 * again, not patch. That is what `handleGetAppConfiguration` writes.
 * KEEP: pubkey and every sign INS.
 */
export async function handleFactomApdu(apdu: Apdu) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x06) {
    const version = versionTriple(catalogVersion('factom', '1.2.4'));
    return encodeResponse(Uint8Array.of(0x00, version[0]!, version[1]!, version[0]!), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
