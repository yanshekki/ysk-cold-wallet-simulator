import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { concatBytes } from '../bytes';
import { versionTriple } from './generic';

/**
 * Inner APDU from LedgerHQ/app-iota `docs/apdu.md` (CLA 0x00).
 * MATCH: GET_VERSION (INS 00) is major, minor, patch, then ASCII `iota`
 * (`ragger-tests/test_version_cmd.py`).
 * KEEP: VERIFY_ADDRESS, GET_PUBKEY, SIGN_TX, QUIT_APP, and the block-protocol envelope.
 */
const IOTA_NAME = Uint8Array.of(0x69, 0x6f, 0x74, 0x61);

export async function handleIotaApdu(apdu: Apdu) {
  if (apdu.cla !== 0x00) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(concatBytes(versionTriple(catalogVersion('iota', '1.0.4')), IOTA_NAME), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
