import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { encodePubAndAddress, xrpClassic } from './addresses';
import type { Apdu } from '../apdu';

export type XrpSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'XRP',
    clas: [0xe0],
    versionIns: [0x06],
    pubkeyIns: [0x02],
    signIns: [0x04],
    curve: 'secp256k1',
    versionBytes: () => versionTriple(catalogVersion('xrp', '2.6.1')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, xrpClassic(publicKey)),
    hashForSign: (message) => sha256(sha256(message)),
  };
}

export function handleXrpApdu(apdu: Apdu, ctx: FamilyContext, session: XrpSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
