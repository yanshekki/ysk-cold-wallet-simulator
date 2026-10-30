import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type EosSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-eos `src/main.c` (CLA 0xD4).
 * MATCH: GET_APP_CONFIGURATION flags||maj||min||patch (4-byte).
 * KEEP: GET_PUBLIC_KEY (WIF address) / SIGN (EOS stream parse + canonical sig).
 */
export async function handleEosApdu(apdu: Apdu, _ctx: FamilyContext, _session: EosSession) {
  if (apdu.cla !== 0xd4) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x06) {
    const version = versionTriple(catalogVersion('eos', '1.6.1'));
    // flags: data-allowed bit set so hosts that gate on it proceed
    return encodeResponse(Uint8Array.of(0x01, version[0]!, version[1]!, version[2]!), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
