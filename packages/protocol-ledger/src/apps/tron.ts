import { catalogVersion } from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  handleFamilyApdu,
  previewTronTransfer,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
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
    versionBytes: () => {
      const version = versionTriple(catalogVersion('tron', '0.8.3'));
      // hw-app-trx: flags || major || minor || patch
      return Uint8Array.of(0x00, version[0], version[1], version[2]);
    },
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, tronBase58(publicKey)),
    hashForSign: (message) => keccak_256(message),
    preview: previewTronTransfer,
  };
}

export function handleTronApdu(apdu: Apdu, ctx: FamilyContext, session: TronSession) {
  if (spec().pubkeyIns.includes(apdu.ins)) {
    return handleFamilyApdu({ ...apdu, p1: 0x00 }, spec(), ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
