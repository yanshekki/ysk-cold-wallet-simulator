import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { cosmosBech32, encodePubAndAddress } from './addresses';
import type { Apdu } from '../apdu';

export type CosmosSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'Cosmos',
    clas: [0x55],
    versionIns: [0x00],
    pubkeyIns: [0x04],
    signIns: [0x02],
    curve: 'secp256k1',
    versionBytes: () => versionTriple(catalogVersion('cosmos', '2.36.15')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, cosmosBech32(publicKey)),
    hashForSign: (message) => sha256(message),
  };
}

export function handleCosmosApdu(apdu: Apdu, ctx: FamilyContext, session: CosmosSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
