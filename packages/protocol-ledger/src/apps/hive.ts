import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type HiveSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-hive `doc/COMMANDS.md` (CLA 0xD4).
 * MATCH: GET_VERSION maj||min||patch (3-byte).
 * KEEP: GET_PUBLIC_KEY (WIF) / SIGN_TRANSACTION / SIGN_HASH / GET_SETTINGS.
 */
export async function handleHiveApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xd4) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x06) {
    const version = versionTriple(catalogVersion('hive', '1.1.2'));
    return encodeResponse(version, SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
