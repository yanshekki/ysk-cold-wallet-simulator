import { blake2b } from '@noble/hashes/blake2b';
import type { FamilyContext, FamilySession } from './generic';
import { concatBytes, readU32BE } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_OK,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { deriveIcarus, deriveIcarusFromRoot } from './icarus';
import { icarusRootFor } from '../crypto';

/**
 * LedgerHQ/app-cardano §6.1, `derive_native_script_hash.c`, and
 * `derive_native_script_hash_builder.c`. The hash is blake2b-224 of
 * `0x00 ‖` CBOR(script). `MAX_SCRIPT_DEPTH` in the firmware types header is 11.
 */
const SCRIPT_DEPTH = 11;
const SW_WRONG_DATA = 0x6a87;
const SW_NOT_ALLOWED = 0x6980;
const SW_SECURITY = 0x6982;
const SW_SCRIPT_PUBKEY = 0x6b41;
const SW_SCRIPT_TYPE = 0x6b42;
const SW_SCRIPT_NESTING = 0x6b43;
const SW_SCRIPT_TIMELOCK = 0x6b44;
const SW_SCRIPT_DEPTH = 0x6b45;
const SW_SCRIPT_COUNT = 0x6b46;
const SW_SCRIPT_DISPLAY = 0x6b47;
const HARD = 0x80000000;

const SCRIPT_PUBKEY = 0x00;
const SCRIPT_ALL = 0x01;
const SCRIPT_ANY = 0x02;
const SCRIPT_N_OF_K = 0x03;
const SCRIPT_BEFORE = 0x04;
const SCRIPT_AFTER = 0x05;

function emptyOk(): Uint8Array {
  return encodeResponse(new Uint8Array(), SW_OK);
}

function scriptFail(session: FamilySession, sw: number): Uint8Array {
  session.cardanoNativeScript = undefined;
  return encodeResponse(new Uint8Array(), sw);
}

function hard(index: number): number {
  return (index | HARD) >>> 0;
}

function isHard(value: number): boolean {
  return (value & HARD) !== 0;
}

/** `bip44_classifyPath` is anything except `PATH_INVALID`. */
function isRecognizedCardanoPath(components: number[]): boolean {
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
  if (purpose === hard(1694)) {
    if (account === undefined || !isHard(account)) {
      return false;
    }
    if (components.length === 3) {
      return true;
    }
    return components.length === 5 && components[3] === 0 && !isHard(components[4] ?? 0);
  }
  const shelley = purpose === hard(1852);
  const byron = purpose === hard(44);
  const multisig = purpose === hard(1854);
  if (!shelley && !byron && !multisig) {
    return false;
  }
  if (account === undefined || !isHard(account)) {
    return false;
  }
  if (components.length === 3) {
    return true;
  }
  if (components.length !== 5) {
    return false;
  }
  const chain = components[3] ?? 0;
  const address = components[4] ?? 0;
  if (multisig) {
    if (chain === 0) {
      return !isHard(address);
    }
    return (chain === 2 || chain === 3) && !isHard(address);
  }
  if (chain === 0 || chain === 1) {
    return true;
  }
  return shelley && chain >= 2 && chain <= 5 && !isHard(address);
}

function cborToken(major: number, value: bigint): Uint8Array {
  const type = (major << 5) & 0xe0;
  if (value < 24n) {
    return Uint8Array.of(type | Number(value));
  }
  if (value < 256n) {
    return Uint8Array.of(type | 24, Number(value));
  }
  if (value < 65536n) {
    return Uint8Array.of(type | 25, Number((value >> 8n) & 0xffn), Number(value & 0xffn));
  }
  if (value < 2n ** 32n) {
    const n = Number(value);
    return Uint8Array.of(type | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  }
  const out = new Uint8Array(9);
  out[0] = type | 27;
  let rest = value;
  for (let i = 8; i >= 1; i -= 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function append(script: NonNullable<FamilySession['cardanoNativeScript']>, bytes: Uint8Array): void {
  script.cbor = concatBytes(script.cbor, bytes);
}

function propagate(script: NonNullable<FamilySession['cardanoNativeScript']>): void {
  while (script.level > 0 && script.remaining[script.level] === 0) {
    script.level -= 1;
    script.remaining[script.level] = (script.remaining[script.level] ?? 1) - 1;
  }
}

function readPath(data: Uint8Array): { path: string; components: number[]; rest: Uint8Array } | null {
  if (data.length < 1 || data[0] === 0 || data[0] > 5) {
    return null;
  }
  try {
    const parsed = parseBip32Path(data);
    const components: number[] = [];
    for (let i = 0; i < data[0]; i += 1) {
      const offset = 1 + i * 4;
      components.push(readU32BE(data, offset));
    }
    return { path: parsed.path, components, rest: parsed.rest };
  } catch {
    return null;
  }
}

async function show(
  ctx: FamilyContext,
  message: string,
  rawPayload: Uint8Array,
): Promise<boolean> {
  return ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'sign',
    title: 'Cardano native script',
    path: 'cardano-native-script',
    message,
    rawPayload,
  });
}

async function icarusPub(ctx: FamilyContext, path: string): Promise<Uint8Array> {
  const root = await icarusRootFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = root ? deriveIcarusFromRoot(root, path) : deriveIcarus(ctx.entropy, path, undefined, ctx.backup);
  return node.publicKey;
}

export async function handleCardanoNativeScript(
  apdu: Apdu,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array> {
  const p1 = apdu.p1;
  if (apdu.p2 !== 0x00 || p1 > 0x03) {
    return scriptFail(session, SW_WRONG_P1P2);
  }
  if (p1 === 0x00) {
    return scriptInit(apdu, ctx, session);
  }
  if (!session.cardanoNativeScript) {
    return scriptFail(session, SW_NOT_ALLOWED);
  }
  if (p1 === 0x01) {
    return scriptComplex(apdu, ctx, session);
  }
  if (p1 === 0x02) {
    return scriptSimple(apdu, ctx, session);
  }
  return scriptFinish(apdu, ctx, session);
}

async function scriptInit(
  apdu: Apdu,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array> {
  if (session.cardanoNativeScript) {
    return scriptFail(session, SW_NOT_ALLOWED);
  }
  if (apdu.data.length !== 0) {
    return encodeResponse(new Uint8Array(), SW_WRONG_DATA);
  }
  const script: NonNullable<FamilySession['cardanoNativeScript']> = {
    level: 0,
    remaining: Array.from({ length: SCRIPT_DEPTH }, () => 0),
    cbor: Uint8Array.of(0x00),
  };
  script.remaining[0] = 1;
  session.cardanoNativeScript = script;
  const ok = await show(ctx, 'Cardano native script', script.cbor);
  if (!ok) {
    return scriptFail(session, SW_DENY);
  }
  return emptyOk();
}

async function scriptComplex(
  apdu: Apdu,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array> {
  const script = session.cardanoNativeScript;
  if (!script || script.remaining[script.level] === 0) {
    return scriptFail(session, SW_SCRIPT_NESTING);
  }
  if (script.level + 1 >= SCRIPT_DEPTH) {
    return scriptFail(session, SW_SCRIPT_DEPTH);
  }
  if (apdu.data.length < 1) {
    return scriptFail(session, SW_SCRIPT_TYPE);
  }
  const kind = apdu.data[0] ?? 0;
  if (kind !== SCRIPT_ALL && kind !== SCRIPT_ANY && kind !== SCRIPT_N_OF_K) {
    return scriptFail(session, SW_SCRIPT_TYPE);
  }
  if (apdu.data.length < 5) {
    return scriptFail(session, SW_WRONG_DATA);
  }
  const total = readU32BE(apdu.data, 1);
  const rest = apdu.data.subarray(5);
  script.level += 1;
  script.remaining[script.level] = total;
  if (kind !== SCRIPT_N_OF_K) {
    if (rest.length !== 0) {
      return scriptFail(session, SW_WRONG_DATA);
    }
    append(script, concatBytes(cborToken(4, 2n), cborToken(0, BigInt(kind)), cborToken(4, BigInt(total))));
  } else {
    if (rest.length < 4) {
      return scriptFail(session, SW_WRONG_DATA);
    }
    if (rest.length !== 4) {
      return scriptFail(session, SW_WRONG_DATA);
    }
    const required = readU32BE(rest, 0);
    if (total < required) {
      return scriptFail(session, SW_SCRIPT_COUNT);
    }
    append(
      script,
      concatBytes(
        cborToken(4, 3n),
        cborToken(0, BigInt(SCRIPT_N_OF_K)),
        cborToken(0, BigInt(required)),
        cborToken(4, BigInt(total)),
      ),
    );
  }
  if (script.remaining[script.level] === 0) {
    propagate(script);
  }
  const ok = await show(ctx, `Cardano native script ${kind === SCRIPT_ALL ? 'all' : kind === SCRIPT_ANY ? 'any' : 'n of k'}`, script.cbor);
  if (!ok) {
    return scriptFail(session, SW_DENY);
  }
  return emptyOk();
}

async function scriptSimple(
  apdu: Apdu,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array> {
  const script = session.cardanoNativeScript;
  if (!script || script.remaining[script.level] === 0) {
    return scriptFail(session, SW_SCRIPT_NESTING);
  }
  if (apdu.data.length < 1) {
    return scriptFail(session, SW_SCRIPT_TYPE);
  }
  const kind = apdu.data[0] ?? 0;
  const payload = apdu.data.subarray(1);
  if (kind === SCRIPT_PUBKEY) {
    const added = await addPubkey(payload, ctx, session, script);
    if (added) {
      return added;
    }
  } else if (kind === SCRIPT_BEFORE || kind === SCRIPT_AFTER) {
    if (payload.length < 8) {
      return scriptFail(session, SW_SCRIPT_TIMELOCK);
    }
    if (payload.length !== 8) {
      return scriptFail(session, SW_WRONG_DATA);
    }
    const slot = u64(payload);
    append(script, concatBytes(cborToken(4, 2n), cborToken(0, BigInt(kind)), cborToken(0, slot)));
  } else {
    return scriptFail(session, SW_SCRIPT_TYPE);
  }
  script.remaining[script.level] = (script.remaining[script.level] ?? 1) - 1;
  propagate(script);
  const ok = await show(ctx, 'Cardano native script leaf', script.cbor);
  if (!ok) {
    return scriptFail(session, SW_DENY);
  }
  return emptyOk();
}

async function addPubkey(
  payload: Uint8Array,
  ctx: FamilyContext,
  session: FamilySession,
  script: NonNullable<FamilySession['cardanoNativeScript']>,
): Promise<Uint8Array | null> {
  if (payload.length < 1) {
    return scriptFail(session, SW_SCRIPT_PUBKEY);
  }
  const cred = payload[0] ?? 0;
  const body = payload.subarray(1);
  let keyHash: Uint8Array;
  if (cred === 0x00) {
    if (body.length < 28) {
      return scriptFail(session, SW_SCRIPT_PUBKEY);
    }
    if (body.length !== 28) {
      return scriptFail(session, SW_WRONG_DATA);
    }
    keyHash = body;
  } else if (cred === 0x01) {
    return scriptFail(session, SW_SCRIPT_PUBKEY);
  } else if (cred === 0x02) {
    const parsed = readPath(body);
    if (!parsed) {
      return scriptFail(session, SW_SCRIPT_PUBKEY);
    }
    if (parsed.rest.length !== 0) {
      return scriptFail(session, SW_WRONG_DATA);
    }
    if (!isRecognizedCardanoPath(parsed.components)) {
      return scriptFail(session, SW_SECURITY);
    }
    const path = ctx.confirmation.resolvePath?.(parsed.path, ['ada']) ?? parsed.path;
    keyHash = blake2b(await icarusPub(ctx, path), { dkLen: 28 });
  } else {
    return scriptFail(session, SW_SCRIPT_PUBKEY);
  }
  append(
    script,
    concatBytes(cborToken(4, 2n), cborToken(0, 0n), cborToken(2, 28n), keyHash),
  );
  return null;
}

function u64(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

async function scriptFinish(
  apdu: Apdu,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array> {
  const script = session.cardanoNativeScript;
  if (!script || script.level !== 0 || script.remaining[0] !== 0) {
    return scriptFail(session, SW_SCRIPT_NESTING);
  }
  if (apdu.data.length !== 1 || (apdu.data[0] !== 0x01 && apdu.data[0] !== 0x02)) {
    return scriptFail(session, apdu.data.length === 1 ? SW_SCRIPT_DISPLAY : SW_WRONG_DATA);
  }
  const hash = blake2b(script.cbor, { dkLen: 28 });
  const format = apdu.data[0] === 0x01 ? 'bech32' : 'policy id';
  const ok = await show(ctx, `Cardano native script hash ${format}`, hash);
  if (!ok) {
    return scriptFail(session, SW_DENY);
  }
  session.cardanoNativeScript = undefined;
  return encodeResponse(hash, SW_OK);
}
