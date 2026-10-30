import { blake2b } from '@noble/hashes/blake2b';
import type { FamilyContext, FamilySession } from './generic';
import { concatBytes, readU32BE, writeU32BE } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { icarusRootFor } from '../crypto';
import { deriveIcarus, deriveIcarusFromRoot, signIcarus } from './icarus';

/**
 * LedgerHQ/app-cardano §10.1 and `src/handler/sign_msg.c`.
 * Address-field type 0x02 signs the COSE Sig_structure. Type 0x01 stays 6D00.
 * Flags are 0x01 no and 0x02 yes. Chunks are at most 250 bytes.
 */
const CIP8_CHUNK = 250;
const SIG_OVERHEAD = 256;
const SW_MEMORY = 0x6a84;
const SW_WRONG_DATA = 0x6a87;
const SW_NOT_ALLOWED = 0x6980;
const SW_SECURITY = 0x6982;
const SW_MSG_LENGTH = 0x6b60;
const SW_MSG_PATH = 0x6b61;
const SW_MSG_HASH_FLAG = 0x6b62;
const SW_MSG_ASCII_FLAG = 0x6b63;
const SW_MSG_FIELD_TYPE = 0x6b64;
const SW_MSG_CHUNK_SIZE = 0x6b66;
const SW_MSG_CHUNK_DATA = 0x6b67;
const SW_MSG_BAD_CHUNK = 0x6b68;
const SW_MSG_ASCII = 0x6b69;
const SW_MSG_BAD_TYPE = 0x6b6a;
const SW_MSG_CONFIRM = 0x6b6b;
const HARD = 0x80000000;

function emptyOk(): Uint8Array {
  return encodeResponse(new Uint8Array(), SW_OK);
}

function msgFail(session: FamilySession, sw: number): Uint8Array {
  session.cardanoSignMsg = undefined;
  return encodeResponse(new Uint8Array(), sw);
}

function hard(index: number): number {
  return (index | HARD) >>> 0;
}

function isHard(value: number): boolean {
  return (value & HARD) !== 0;
}

/** Classes accepted by `policyForSignMsg`. Account-only and CIP-36 paths are denied. */
function isCip8Path(components: number[]): boolean {
  if (components.length < 2 || components[1] !== hard(1815)) {
    return false;
  }
  const purpose = components[0];
  const account = components[2];
  if (purpose === hard(1853)) {
    return components.length === 4 && components[2] === hard(0) && isHard(components[3] ?? 0);
  }
  if (purpose === hard(1855)) {
    return components.length === 3 && isHard(account ?? 0);
  }
  const shelley = purpose === hard(1852);
  const byron = purpose === hard(44);
  const multisig = purpose === hard(1854);
  if ((!shelley && !byron && !multisig) || components.length !== 5 || account === undefined || !isHard(account)) {
    return false;
  }
  const chain = components[3] ?? 0;
  const address = components[4] ?? 0;
  if (multisig) {
    return (chain === 0 || chain === 2 || chain === 3) && !isHard(address);
  }
  if (chain === 0 || chain === 1) {
    return true;
  }
  return shelley && chain >= 2 && chain <= 5 && !isHard(address);
}

function readFlag(value: number): boolean | null {
  if (value === 0x02) {
    return true;
  }
  if (value === 0x01) {
    return false;
  }
  return null;
}

function lengthAllowed(length: number, hashPayload: boolean, isAscii: boolean): boolean {
  if (isAscii) {
    if (length + 2 > 0xffff) {
      return false;
    }
  } else if (2 * length + 3 > 0xffff) {
    return false;
  }
  return hashPayload || SIG_OVERHEAD + length <= 0xffff;
}

function unambiguousAscii(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  for (const byte of bytes) {
    if (byte < 32 || byte > 126) {
      return false;
    }
  }
  if (bytes[0] === 0x20 || bytes[bytes.length - 1] === 0x20) {
    return false;
  }
  for (let i = 0; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0x20 && bytes[i + 1] === 0x20) {
      return false;
    }
  }
  return true;
}

function cborToken(major: number, value: number): Uint8Array {
  const type = (major << 5) & 0xe0;
  if (value < 24) {
    return Uint8Array.of(type | value);
  }
  if (value < 256) {
    return Uint8Array.of(type | 24, value);
  }
  return Uint8Array.of(type | 25, (value >> 8) & 0xff, value & 0xff);
}

function text(value: string): Uint8Array {
  return concatBytes(cborToken(3, value.length), Uint8Array.from(value, (char) => char.charCodeAt(0)));
}

function bytesToken(value: Uint8Array): Uint8Array {
  return concatBytes(cborToken(2, value.length), value);
}

function sigStructure(keyHash: Uint8Array, payload: Uint8Array): Uint8Array {
  const header = concatBytes(
    cborToken(5, 2),
    cborToken(0, 1),
    Uint8Array.of(0x27),
    text('address'),
    bytesToken(keyHash),
  );
  return concatBytes(cborToken(4, 4), text('Signature1'), bytesToken(header), cborToken(2, 0), bytesToken(payload));
}

function readPath(data: Uint8Array): { path: string; components: number[]; rest: Uint8Array } | null {
  if (data.length < 1 || data[0] === 0 || data[0] > 5) {
    return null;
  }
  try {
    const parsed = parseBip32Path(data);
    const components: number[] = [];
    for (let i = 0; i < data[0]; i += 1) {
      components.push(readU32BE(data, 1 + i * 4));
    }
    return { path: parsed.path, components, rest: parsed.rest };
  } catch {
    return null;
  }
}

async function icarusNode(ctx: FamilyContext, path: string) {
  const root = await icarusRootFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  return root ? deriveIcarusFromRoot(root, path) : deriveIcarus(ctx.entropy, path, undefined, ctx.backup);
}

export async function handleCardanoSignMsg(
  apdu: Apdu,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array> {
  const p1 = apdu.p1;
  if (apdu.p2 !== 0x00 || (p1 !== 0x01 && p1 !== 0x02 && p1 !== 0x03)) {
    return msgFail(session, SW_WRONG_P1P2);
  }
  if (p1 === 0x01) {
    return msgInit(apdu, ctx, session);
  }
  if (!session.cardanoSignMsg) {
    return msgFail(session, SW_NOT_ALLOWED);
  }
  if (p1 === 0x02) {
    return msgChunk(apdu, session);
  }
  return msgConfirm(apdu, ctx, session);
}

async function msgInit(apdu: Apdu, ctx: FamilyContext, session: FamilySession): Promise<Uint8Array> {
  if (session.cardanoSignMsg) {
    return msgFail(session, SW_NOT_ALLOWED);
  }
  if (apdu.data.length < 4) {
    return encodeResponse(new Uint8Array(), SW_MSG_LENGTH);
  }
  const length = readU32BE(apdu.data, 0);
  if (length > 0xffff) {
    return encodeResponse(new Uint8Array(), SW_MEMORY);
  }
  const parsed = readPath(apdu.data.subarray(4));
  if (!parsed) {
    return encodeResponse(new Uint8Array(), SW_MSG_PATH);
  }
  let offset = parsed.rest;
  if (offset.length < 1) {
    return encodeResponse(new Uint8Array(), SW_MSG_HASH_FLAG);
  }
  const hashPayload = readFlag(offset[0] ?? 0);
  if (hashPayload === null) {
    return encodeResponse(new Uint8Array(), SW_MSG_HASH_FLAG);
  }
  offset = offset.subarray(1);
  if (offset.length < 1) {
    return encodeResponse(new Uint8Array(), SW_MSG_ASCII_FLAG);
  }
  const isAscii = readFlag(offset[0] ?? 0);
  if (isAscii === null) {
    return encodeResponse(new Uint8Array(), SW_MSG_ASCII_FLAG);
  }
  offset = offset.subarray(1);
  if (offset.length < 1) {
    return encodeResponse(new Uint8Array(), SW_MSG_FIELD_TYPE);
  }
  const fieldType = offset[0] ?? 0;
  if (fieldType === 0x01) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  if (fieldType !== 0x02) {
    return encodeResponse(new Uint8Array(), SW_MSG_BAD_TYPE);
  }
  if (offset.length !== 1) {
    return encodeResponse(new Uint8Array(), SW_WRONG_DATA);
  }
  if (!lengthAllowed(length, hashPayload, isAscii)) {
    return encodeResponse(new Uint8Array(), SW_MEMORY);
  }
  if (!isCip8Path(parsed.components)) {
    return encodeResponse(new Uint8Array(), SW_SECURITY);
  }
  const path = ctx.confirmation.resolvePath?.(parsed.path, ['ada']) ?? parsed.path;
  const node = await icarusNode(ctx, path);
  session.cardanoSignMsg = {
    state: length === 0 ? 'confirm' : 'chunk',
    hashPayload,
    isAscii,
    message: new Uint8Array(length),
    filled: 0,
    path,
    pubkey: node.publicKey,
    keyHash: blake2b(node.publicKey, { dkLen: 28 }),
  };
  return emptyOk();
}

function msgChunk(apdu: Apdu, session: FamilySession): Uint8Array {
  const msg = session.cardanoSignMsg;
  if (!msg || msg.state !== 'chunk') {
    return msgFail(session, SW_NOT_ALLOWED);
  }
  if (apdu.data.length < 4) {
    return msgFail(session, SW_MSG_CHUNK_SIZE);
  }
  const size = readU32BE(apdu.data, 0);
  const remaining = msg.message.length - msg.filled;
  const expected = Math.min(remaining, CIP8_CHUNK);
  if (size > remaining || size !== expected) {
    return msgFail(session, SW_MSG_BAD_CHUNK);
  }
  const body = apdu.data.subarray(4);
  if (body.length < size) {
    return msgFail(session, SW_MSG_CHUNK_DATA);
  }
  if (body.length !== size) {
    return msgFail(session, SW_WRONG_DATA);
  }
  msg.message.set(body, msg.filled);
  msg.filled += size;
  if (msg.filled === msg.message.length) {
    if (msg.isAscii && msg.message.length > 0 && !unambiguousAscii(msg.message)) {
      return msgFail(session, SW_MSG_ASCII);
    }
    msg.state = 'confirm';
  }
  return emptyOk();
}

async function msgConfirm(apdu: Apdu, ctx: FamilyContext, session: FamilySession): Promise<Uint8Array> {
  const msg = session.cardanoSignMsg;
  if (!msg || msg.state !== 'confirm') {
    return msgFail(session, SW_NOT_ALLOWED);
  }
  if (apdu.data.length !== 0) {
    return msgFail(session, SW_MSG_CONFIRM);
  }
  const payload = msg.hashPayload ? blake2b(msg.message, { dkLen: 28 }) : msg.message;
  const structure = sigStructure(msg.keyHash, payload);
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign Cardano message',
    path: msg.path,
    message: `Sign Cardano CIP-8 message\n${msg.path}`,
    rawPayload: structure,
  });
  if (!ok) {
    return msgFail(session, SW_DENY);
  }
  const node = await icarusNode(ctx, msg.path);
  const signature = signIcarus(node, structure);
  const body = concatBytes(signature, msg.pubkey, writeU32BE(28), msg.keyHash);
  session.cardanoSignMsg = undefined;
  return encodeResponse(body, SW_OK);
}
