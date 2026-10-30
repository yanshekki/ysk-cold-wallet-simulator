import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type StarknetSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-starknet `docs/apdu.md` (CLA 0x5A).
 * MATCH: GetVersion maj||min||patch (3-byte).
 * KEEP: GetPubKey / GetStarkKey / tx stream INS 0x03–0x06.
 */
export async function handleStarknetApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0x5a) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    const version = versionTriple(catalogVersion('starknet', '2.4.3'));
    return encodeResponse(version, SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
