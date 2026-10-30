import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import {
  handleFamilyApdu,
  previewCosmosSignDoc,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import { cosmosBech32, encodePubAndAddress } from './addresses';
import type { Apdu } from '../apdu';

export type CosmosSession = FamilySession;

/**
 * CLA/INS from Zondax ledger-cosmos `app/src/common/app_main.h`.
 * GET_VERSION body is 9 bytes (handle_getversion). SIGN uses process_chunk P1 0/1/2
 * with a fixed 5-component path and no length byte on init.
 */
function spec(): FamilySpec {
  const version = versionTriple(catalogVersion('cosmos', '2.36.15'));
  return {
    name: 'Cosmos',
    clas: [0x55],
    versionIns: [0x00],
    pubkeyIns: [0x04],
    signIns: [0x02],
    curve: 'secp256k1',
    // test(1)||maj||min||patch||locked||target_id(4) — maj/min/patch are single bytes here
    // (Zondax cosmos uses LEDGER_*_VERSION bytes; Polkadot uses u16 — different app).
    versionBytes: () =>
      Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!, 0x00, 0x00, 0x00, 0x00, 0x00),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, cosmosBech32(publicKey)),
    hashForSign: (message) => sha256(message),
    preview: previewCosmosSignDoc,
    chunkMode: 'p1-zondax',
    signPathMode: 'zondax-fixed5',
    signPathOnlyFirst: true,
  };
}

export function handleCosmosApdu(apdu: Apdu, ctx: FamilyContext, session: CosmosSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
