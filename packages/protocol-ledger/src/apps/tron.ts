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

/**
 * CLA/INS from @ledgerhq/hw-app-trx `Trx.ts` (Ledger Live develop).
 * SIGN chunking uses P1 startBytes (0x10/0x00/0x80/0x90), not P2 bit 0x02.
 */
function spec(): FamilySpec {
  return {
    name: 'Tron',
    clas: [0xe0],
    versionIns: [0x06],
    pubkeyIns: [0x02],
    // ADDRESS 02, SIGN 04, SIGN_HASH 05, SIGN_MESSAGE 08 (ECDH 0A left KEEP — needs peer key UX)
    signIns: [0x04, 0x05, 0x08],
    curve: 'secp256k1',
    versionBytes: () => {
      const version = versionTriple(catalogVersion('tron', '0.8.3'));
      return Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!);
    },
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, tronBase58(publicKey)),
    hashForSign: (message) => keccak_256(message),
    preview: previewTronTransfer,
    chunkMode: 'p1-tron',
  };
}

export function handleTronApdu(apdu: Apdu, ctx: FamilyContext, session: TronSession) {
  if (spec().pubkeyIns.includes(apdu.ins)) {
    return handleFamilyApdu({ ...apdu, p1: 0x00 }, spec(), ctx, session);
  }
  // SIGN_HASH (05): path||32-byte hash — treat payload as already hashed (identity).
  if (apdu.ins === 0x05) {
    const hashSpec: FamilySpec = {
      ...spec(),
      hashForSign: (message) => (message.length === 32 ? message : keccak_256(message)),
      chunkMode: 'p1-tron',
    };
    return handleFamilyApdu(apdu, hashSpec, ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
