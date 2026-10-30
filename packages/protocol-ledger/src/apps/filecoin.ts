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

export type FilecoinSession = FamilySession;

/** Minimal f1-style placeholder from compressed pubkey hash (not full actor codec). */
function filecoinPlaceholder(compressedPub: Uint8Array): string {
  const h = sha256(compressedPub).slice(0, 20);
  return `f1${bytesToHex(h)}`;
}

/**
 * CLA/INS from LedgerHQ/app-filecoin `docs/APDUSPEC.md` + Zondax coin.h (CLA 0x06).
 * MATCH: GET_VERSION / GET_ADDR_SECP256K1 / SIGN_SECP256K1 Zondax chunk path.
 * ETH dual CLA E0 path is routed to the ethereum handler when the Filecoin app is open.
 * SIGN_RAW_BYTES / SIGN_PERSONAL_MESSAGE KEEP.
 */
function spec(): FamilySpec {
  const version = versionTriple(catalogVersion('filecoin', '2.3.15'));
  return {
    name: 'Filecoin',
    clas: [0x06],
    versionIns: [0x00],
    pubkeyIns: [0x01],
    signIns: [0x02],
    curve: 'secp256k1',
    versionBytes: () =>
      Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!, 0x00, 0x00, 0x00, 0x00, 0x00),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, filecoinPlaceholder(publicKey)),
    hashForSign: (message) => sha256(message),
    chunkMode: 'p1-zondax',
    signPathMode: 'zondax-fixed5',
    signPathOnlyFirst: true,
  };
}

export function handleFilecoinApdu(apdu: Apdu, ctx: FamilyContext, session: FilecoinSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
