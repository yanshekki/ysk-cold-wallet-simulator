import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { encodePubAndAddress, xrpClassic } from './addresses';
import type { Apdu } from '../apdu';

export type XrpSession = FamilySession;

function spec(): FamilySpec {
  const version = versionTriple(catalogVersion('xrp', '2.6.1'));
  return {
    name: 'XRP',
    clas: [0xe0],
    versionIns: [0x06],
    pubkeyIns: [0x02],
    signIns: [0x04],
    curve: 'secp256k1',
    // hw-app-xrp getAppConfiguration reads response[1..3] with SW still attached on transport.send,
    // matching a 4-byte body (flags||maj||min||patch) like Tron — not a bare triple.
    versionBytes: () => Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, xrpClassic(publicKey)),
    hashForSign: (message) => sha256(sha256(message)),
    // hw-app-xrp: P1 = (isFirst?0:1)|(hasMore?0x80:0); P2 = curve mask
    chunkMode: 'p1-xrp',
  };
}

export function handleXrpApdu(apdu: Apdu, ctx: FamilyContext, session: XrpSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
