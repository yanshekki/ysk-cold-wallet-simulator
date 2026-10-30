import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import type { Apdu } from '../apdu';

export type CasperSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-casper `docs/APDUSPEC.md` (CLA 0x06).
 * Dedicated family — same CLA as Filecoin but different response shapes:
 * MATCH: GET_VERSION 5-byte (test||maj||min||patch||locked);
 * GET_ADDR_SECP256K1 = 33-byte compressed PK only;
 * SIGN_SECP256K1 = R||S 64 (no recovery byte).
 */
function spec(): FamilySpec {
  const version = versionTriple(catalogVersion('casper', '3.1.9'));
  return {
    name: 'Casper',
    clas: [0x06],
    versionIns: [0x00],
    pubkeyIns: [0x01],
    signIns: [0x02],
    curve: 'secp256k1',
    versionBytes: () => Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!, 0x00),
    encodePubkey: (publicKey) => publicKey,
    hashForSign: (message) => sha256(message),
    encodeSignResponse: (signature) => signature.subarray(0, 64),
    chunkMode: 'p1-zondax',
    signPathMode: 'zondax-fixed5',
    signPathOnlyFirst: true,
  };
}

export function handleCasperApdu(apdu: Apdu, ctx: FamilyContext, session: CasperSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
