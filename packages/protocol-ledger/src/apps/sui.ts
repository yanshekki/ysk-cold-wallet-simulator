import { catalogVersion } from '@cws/contracts';
import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha2';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import { encodePubAndAddress, suiAddress, suiAddressBytes } from './addresses';
import {
  encodeResponse,
  parseBip32PathLE,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { concatBytes, readU32LE } from '../bytes';
import { deriveEd25519PrivateKeyFromSeed, ed25519PublicKey, seedFor, signEd25519 } from '../crypto';

export type SuiSession = FamilySession;

const LEDGER_TO_HOST = {
  RESULT_FINAL: 0x01,
  GET_CHUNK: 0x02,
} as const;

const HOST_TO_LEDGER = {
  START: 0x00,
  GET_CHUNK_RESPONSE_SUCCESS: 0x01,
  GET_CHUNK_RESPONSE_FAILURE: 0x02,
  PUT_CHUNK_RESPONSE: 0x03,
  RESULT_ACCUMULATING_RESPONSE: 0x04,
} as const;

const INS = {
  GET_VERSION: 0x00,
  GET_PUBKEY: 0x01,
  GET_PUBKEY_SILENT: 0x02,
  SIGN: 0x03,
} as const;

/** Mysten `transport.send` already dropped ISO 9000, then slices another 2 bytes as an inner SW. */
const INNER_SW = Uint8Array.of(0x90, 0x00);

function spec(): FamilySpec {
  return {
    name: 'Sui',
    clas: [0x00],
    versionIns: [INS.GET_VERSION],
    pubkeyIns: [INS.GET_PUBKEY, INS.GET_PUBKEY_SILENT],
    signIns: [INS.SIGN],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('sui', '0.9.2')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, suiAddress(publicKey)),
    hashForSign: (message) => blake2b(message, { dkLen: 32 }),
  };
}

function encodeSuiBlock(instruction: number, payload: Uint8Array): Uint8Array {
  return encodeResponse(concatBytes(Uint8Array.of(instruction), payload, INNER_SW), SW_OK);
}

function isStart(data: Uint8Array): boolean {
  return data.length >= 33 && data[0] === HOST_TO_LEDGER.START && (data.length - 1) % 32 === 0;
}

function isContinue(data: Uint8Array): boolean {
  const tag = data[0];
  return (
    tag === HOST_TO_LEDGER.GET_CHUNK_RESPONSE_SUCCESS ||
    tag === HOST_TO_LEDGER.GET_CHUNK_RESPONSE_FAILURE ||
    tag === HOST_TO_LEDGER.PUT_CHUNK_RESPONSE ||
    tag === HOST_TO_LEDGER.RESULT_ACCUMULATING_RESPONSE
  );
}

function splitHashes(data: Uint8Array): Uint8Array[] {
  const hashes: Uint8Array[] = [];
  for (let offset = 1; offset + 32 <= data.length; offset += 32) {
    hashes.push(data.slice(offset, offset + 32));
  }
  return hashes;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i]! ^ right[i]!;
  }
  return diff === 0;
}

function isZeroHash(bytes: Uint8Array): boolean {
  return bytes.length === 32 && bytes.every((byte) => byte === 0);
}

function abortBlocks(session: SuiSession): Uint8Array {
  session.suiBlocks = undefined;
  return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
}

function suiPath(ctx: FamilyContext, path: string): string {
  return ctx.confirmation.resolvePath?.(path, ['sui']) ?? path;
}

async function finishSuiCommand(
  ins: number,
  payloads: Uint8Array[],
  ctx: FamilyContext,
): Promise<Uint8Array> {
  if (ins === INS.GET_VERSION) {
    return encodeSuiBlock(LEDGER_TO_HOST.RESULT_FINAL, spec().versionBytes());
  }
  if (ins === INS.GET_PUBKEY || ins === INS.GET_PUBKEY_SILENT) {
    const packed = payloads[0];
    if (!packed) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    let path: string;
    try {
      path = suiPath(ctx, parseBip32PathLE(packed).path);
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
    }
    if (ins === INS.GET_PUBKEY) {
      const ok = await ctx.confirmation.confirm({
        brand: 'ledger',
        kind: 'address',
        title: 'Export Sui key',
        path,
        message: `Export Sui public key\n${path}`,
        rawPayload: packed,
      });
      if (!ok) {
        return encodeResponse(new Uint8Array(), SW_DENY);
      }
    }
    const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
    const publicKey = ed25519PublicKey(deriveEd25519PrivateKeyFromSeed(seed, path));
    const address = suiAddressBytes(publicKey);
    return encodeSuiBlock(
      LEDGER_TO_HOST.RESULT_FINAL,
      concatBytes(Uint8Array.of(publicKey.length), publicKey, Uint8Array.of(address.length), address),
    );
  }
  if (ins === INS.SIGN) {
    const txnPayload = payloads[0];
    const pathPayload = payloads[1];
    if (!txnPayload || !pathPayload) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    let path: string;
    try {
      path = suiPath(ctx, parseBip32PathLE(pathPayload).path);
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
    }
    const declared = txnPayload.length >= 4 ? readU32LE(txnPayload, 0) : 0;
    const txn =
      txnPayload.length >= 4 + declared ? txnPayload.subarray(4, 4 + declared) : txnPayload.subarray(Math.min(4, txnPayload.length));
    if (txn.length === 0) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const ok = await ctx.confirmation.confirm({
      brand: 'ledger',
      kind: 'sign',
      title: 'Sign Sui',
      path,
      message: `Sign Sui\n${path}`,
      rawPayload: txn,
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
    const digest = blake2b(txn, { dkLen: 32 });
    const signature = signEd25519(deriveEd25519PrivateKeyFromSeed(seed, path), digest);
    return encodeSuiBlock(LEDGER_TO_HOST.RESULT_FINAL, signature);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}

async function handleSuiBlocks(apdu: Apdu, ctx: FamilyContext, session: SuiSession): Promise<Uint8Array> {
  if (isStart(apdu.data)) {
    const hashes = splitHashes(apdu.data);
    if (hashes.length === 0) {
      return abortBlocks(session);
    }
    const [pending, ...remaining] = hashes;
    session.suiBlocks = {
      ins: apdu.ins,
      pendingHash: pending!,
      remainingHashes: remaining,
      currentPayload: new Uint8Array(),
      payloads: [],
    };
    return encodeSuiBlock(LEDGER_TO_HOST.GET_CHUNK, pending!);
  }

  const state = session.suiBlocks;
  if (!state) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  if (apdu.data[0] === HOST_TO_LEDGER.GET_CHUNK_RESPONSE_FAILURE) {
    return abortBlocks(session);
  }
  if (apdu.data[0] !== HOST_TO_LEDGER.GET_CHUNK_RESPONSE_SUCCESS || apdu.data.length < 33) {
    return abortBlocks(session);
  }

  const linked = apdu.data.subarray(1);
  if (!bytesEqual(sha256(linked), state.pendingHash)) {
    return abortBlocks(session);
  }
  const nextHash = linked.subarray(0, 32);
  const chunk = linked.subarray(32);
  state.currentPayload = concatBytes(state.currentPayload, chunk);

  if (!isZeroHash(nextHash)) {
    state.pendingHash = nextHash.slice();
    return encodeSuiBlock(LEDGER_TO_HOST.GET_CHUNK, state.pendingHash);
  }

  state.payloads.push(state.currentPayload);
  state.currentPayload = new Uint8Array();
  const nextParameter = state.remainingHashes.shift();
  if (nextParameter) {
    state.pendingHash = nextParameter;
    return encodeSuiBlock(LEDGER_TO_HOST.GET_CHUNK, nextParameter);
  }

  session.suiBlocks = undefined;
  return finishSuiCommand(state.ins, state.payloads, ctx);
}

export function handleSuiApdu(apdu: Apdu, ctx: FamilyContext, session: SuiSession) {
  if (isStart(apdu.data) || (session.suiBlocks && isContinue(apdu.data))) {
    return handleSuiBlocks(apdu, ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
