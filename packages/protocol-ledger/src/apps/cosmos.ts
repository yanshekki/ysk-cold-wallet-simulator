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
import { encodeResponse, pathToString, SW_DENY, SW_OK, type Apdu } from '../apdu';
import { encodeAscii } from '../bytes';
import { derivePrivateKeyFromSeed, publicKeyCompressed, seedFor } from '../crypto';

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
  if (apdu.ins === 0x04) {
    const requested = parseCosmosHrpRequest(apdu.data);
    if (requested) {
      return exportCosmosHrpAddress(apdu, ctx, requested);
    }
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}

type CosmosHrpRequest = { hrp: string; path: string };

/**
 * hw-app-cosmos `serializeHRP` + `serializePath`: one HRP length byte, the HRP,
 * then five little-endian path components. `crypto_fillAddress` returns the
 * 33-byte compressed key and the bech32 text with no length prefixes.
 * A BIP32 length-prefixed body is left to the generic helper.
 */
function parseCosmosHrpRequest(data: Uint8Array): CosmosHrpRequest | undefined {
  if (data.length < 22) {
    return undefined;
  }
  const hrpLen = data[0]!;
  if (hrpLen < 1 || hrpLen > 83 || data.length !== 1 + hrpLen + 20) {
    return undefined;
  }
  const hrpBytes = data.subarray(1, 1 + hrpLen);
  for (const byte of hrpBytes) {
    if (byte < 0x21 || byte > 0x7e) {
      return undefined;
    }
  }
  const components: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const offset = 1 + hrpLen + index * 4;
    components.push(
      (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0,
    );
  }
  return { hrp: encodeAsciiToString(hrpBytes), path: pathToString(components) };
}

function encodeAsciiToString(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

async function exportCosmosHrpAddress(
  apdu: Apdu,
  ctx: FamilyContext,
  requested: CosmosHrpRequest,
): Promise<Uint8Array> {
  if (apdu.p1 !== 0x00 || ctx.confirmSilentPublic) {
    const ok = await ctx.confirmation.confirm({
      brand: 'ledger',
      kind: 'address',
      title: 'Export Cosmos address',
      path: requested.path,
      message: `Export Cosmos address\n${requested.hrp}\n${requested.path}`,
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const compressed = publicKeyCompressed(derivePrivateKeyFromSeed(seed, requested.path));
  const address = encodeAscii(cosmosBech32(compressed, requested.hrp));
  return encodeResponse(concatPubkey(compressed, address), SW_OK);
}

function concatPubkey(publicKey: Uint8Array, address: Uint8Array): Uint8Array {
  const out = new Uint8Array(publicKey.length + address.length);
  out.set(publicKey, 0);
  out.set(address, publicKey.length);
  return out;
}
