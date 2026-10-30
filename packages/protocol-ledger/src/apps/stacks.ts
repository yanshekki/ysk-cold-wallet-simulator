import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import { encodePubAndAddress } from './addresses';
import { bytesToHex } from '../bytes';
import type { Apdu } from '../apdu';

export type StacksSession = FamilySession;

function stacksPlaceholder(compressedPub: Uint8Array): string {
  return `SP${bytesToHex(sha256(compressedPub).slice(0, 20))}`;
}

/**
 * CLA/INS from LedgerHQ/app-stacks `docs/APDUSPEC.md` (CLA 0x09).
 * MATCH: GET_VERSION / GET_ADDR_SECP256K1 / SIGN_SECP256K1 Zondax chunk path.
 * GET_AUTH_PUBKEY / SIGN_JWT / GET_MASTER_KEY_FINGERPRINT KEEP.
 */
function spec(): FamilySpec {
  const version = versionTriple(catalogVersion('stacks', '0.26.19'));
  return {
    name: 'Stacks',
    clas: [0x09],
    versionIns: [0x00],
    pubkeyIns: [0x01],
    signIns: [0x02],
    curve: 'secp256k1',
    versionBytes: () =>
      Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!, 0x00, 0x00, 0x00, 0x00, 0x00),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, stacksPlaceholder(publicKey)),
    hashForSign: (message) => sha256(message),
    chunkMode: 'p1-zondax',
    signPathMode: 'zondax-fixed5',
    signPathOnlyFirst: true,
  };
}

export function handleStacksApdu(apdu: Apdu, ctx: FamilyContext, session: StacksSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
