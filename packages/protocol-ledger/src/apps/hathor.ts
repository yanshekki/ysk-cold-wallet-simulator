import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type HathorSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-hathor `doc/COMMANDS.md` (CLA 0xE0).
 * MATCH: GET_VERSION ASCII 'HTR'||maj||min||patch (6-byte).
 * KEEP: GET_ADDRESS / GET_XPUB / SIGN_TX / token registry INS.
 */
export async function handleHathorApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x03) {
    const version = versionTriple(catalogVersion('hathor', '1.1.2'));
    return encodeResponse(
      Uint8Array.of(0x48, 0x54, 0x52, version[0]!, version[1]!, version[2]!),
      SW_OK,
    );
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
