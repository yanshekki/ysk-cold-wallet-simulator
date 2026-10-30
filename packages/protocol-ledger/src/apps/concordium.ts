import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type ConcordiumSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-concordium `doc/APDU.md` + `doc/ins_get_app_version.md` (CLA 0xE0).
 * MATCH: Get app version maj||min||patch (3-byte) INS 0x40.
 * KEEP: Get public key / transfer / baker / PLT and other Concordium INS.
 */
export async function handleConcordiumApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x40) {
    const version = versionTriple(catalogVersion('concordium', '5.7.0'));
    return encodeResponse(version, SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
