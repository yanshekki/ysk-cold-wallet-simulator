import { catalogVersion } from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { encodePubAndAddress, tronBase58 } from './addresses';
import type { Apdu } from '../apdu';

export type TronSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'Tron',
    clas: [0xe0],
    versionIns: [0x06],
    pubkeyIns: [0x02],
    signIns: [0x04],
    curve: 'secp256k1',
    versionBytes: () => versionTriple(catalogVersion('tron', '0.8.3')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, tronBase58(publicKey)),
    hashForSign: (message) => keccak_256(message),
  };
}

export function handleTronApdu(apdu: Apdu, ctx: FamilyContext, session: TronSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
