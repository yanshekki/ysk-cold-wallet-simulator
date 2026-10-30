import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type HederaSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-hedera `src/handlers.h` + `get_app_configuration.c` (CLA 0xE0).
 * MATCH: GET_APP_CONFIGURATION storage||maj||min||patch (4-byte).
 * KEEP: GET_PUBLIC_KEY / SIGN_TRANSACTION (Hedera protobuf + ed25519 path layout).
 */
export async function handleHederaApdu(apdu: Apdu, _ctx: FamilyContext, _session: HederaSession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    const version = versionTriple(catalogVersion('hedera', '1.9.3'));
    return encodeResponse(Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
