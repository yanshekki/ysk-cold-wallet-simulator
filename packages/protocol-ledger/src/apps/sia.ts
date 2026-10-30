import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type SiaSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-sia `docs/apdu.md` (CLA 0xE0).
 * MATCH: GET_VERSION maj||min||patch (3-byte).
 * KEEP: GET_PUBLIC_KEY / SIGN_HASH / GET_TXN_HASH / GET_V2TXN_HASH.
 */
export async function handleSiaApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    const version = versionTriple(catalogVersion('sia', '2.2.1'));
    return encodeResponse(version, SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
