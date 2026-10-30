import type { SigningRequest } from '@cws/contracts';
import { catalogVersion } from '@cws/contracts';
import { blake2b } from '@noble/hashes/blake2b';
import { concatBytes, readU32BE } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_CLA_NOT_SUPPORTED,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { versionTriple, type CardanoTxWire, type FamilyContext, type FamilySession } from './generic';
import { cardanoEnterprise, encodePubAndAddress } from './addresses';
import { icarusRootFor } from '../crypto';
import { deriveIcarus, deriveIcarusFromRoot, signIcarus } from './icarus';

export type CardanoSession = FamilySession;

function versionBytes(): Uint8Array {
  const version = versionTriple(catalogVersion('cardano', '7.2.1'));
  // hw-app-cardano GET_VERSION expects major || minor || patch || flags.
  // Release flags are 0. Bit 0x01 marks a devel build and bit 0x04 marks the XS app.
  return Uint8Array.of(version[0], version[1], version[2], 0x00);
}

export async function handleCardanoApdu(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array | null> {
  if (apdu.cla !== 0xd7 && apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(versionBytes(), SW_OK);
  }
  if (apdu.ins === 0x10) {
    return exportExtPubkey(apdu, ctx);
  }
  if (apdu.ins === 0x11) {
    return exportAddress(apdu, ctx);
  }
  if (apdu.ins === 0x21) {
    return signTransaction(apdu, ctx, session);
  }
  if (apdu.ins === 0x22) {
    return signOpCert(apdu, ctx);
  }
  if (apdu.ins === 0x23) {
    return signCvote(apdu, ctx, session);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}

/**
 * @cardano-foundation/ledgerjs-hw-app-cardano `isV8App`: major >= 8.
 * major <= 7 uses the v7 stage map, including 7.0 through 7.2.1.
 */
export function cardanoWireProtocol(version = catalogVersion('cardano', '8.0.8')): 'v7' | 'v8' {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 8 ? 'v8' : 'v7';
}

const V8_WITNESS = 0x0f;
const V8_INIT = 0x10;
const V8_CHUNK = 0x11;
const V8_CONFIRM = 0x12;

const V7_INIT = 0x01;
const V7_CONFIRM = 0x0a;
const V7_WITNESS = 0x0f;
/** CIP-36 registration confirm. Host expects 32-byte hash || 64-byte signature. */
const V7_AUX_CONFIRM_P2 = 0x34;

/**
 * v7 SIGN_TX stages that return an empty body. 0x10/0x11/0x12 are total
 * collateral, reference inputs, and collateral output — not the v8 stream.
 */
const V7_EMPTY_P1 = new Set([
  V7_INIT,
  0x02,
  0x03,
  0x04,
  0x05,
  0x06,
  0x07,
  0x08,
  0x09,
  0x0b,
  0x0c,
  0x0d,
  0x0e,
  0x10,
  0x11,
  0x12,
  0x13,
  0x15,
  0x16,
]);

function emptyOk(): Uint8Array {
  return encodeResponse(new Uint8Array(), SW_OK);
}

function txHash(body: Uint8Array): Uint8Array {
  return blake2b(body, { dkLen: 32 });
}

function openTx(session: CardanoSession, protocol: 'v7' | 'v8', reset: boolean): CardanoTxWire {
  if (reset || !session.cardanoTx || session.cardanoTx.protocol !== protocol) {
    session.cardanoTx = { protocol, body: new Uint8Array() };
  }
  return session.cardanoTx;
}

function remember(tx: CardanoTxWire, data: Uint8Array): void {
  if (data.length > 0) {
    tx.body = concatBytes(tx.body, data);
    tx.hash = undefined;
  }
}

async function signTransaction(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array> {
  return cardanoWireProtocol() === 'v8'
    ? signTransactionV8(apdu, ctx, session)
    : signTransactionV7(apdu, ctx, session);
}

async function signTransactionV8(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array> {
  if (apdu.p1 === V8_INIT) {
    openTx(session, 'v8', true);
    return emptyOk();
  }
  if (apdu.p1 === V8_CHUNK) {
    remember(openTx(session, 'v8', false), apdu.data);
    return emptyOk();
  }
  if (apdu.p1 === V8_CONFIRM) {
    const tx = openTx(session, 'v8', false);
    remember(tx, apdu.data);
    if (tx.body.length === 0) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const ok = await confirmTx(ctx, tx.body);
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    tx.hash = txHash(tx.body);
    return encodeResponse(tx.hash, SW_OK);
  }
  if (apdu.p1 === V8_WITNESS) {
    return signWitness(apdu, ctx, session, 'v8');
  }
  // P1 0x13 is the CIP-36 auxiliary sub-flow. The last APDU is 96 bytes.
  // That parser is not implemented; do not answer it with a witness signature.
  if (apdu.p1 === 0x13) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
}

async function signTransactionV7(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array> {
  if (apdu.p1 === 0x08 && apdu.p2 === V7_AUX_CONFIRM_P2) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  if (apdu.p1 === V7_INIT) {
    const tx = openTx(session, 'v7', true);
    remember(tx, apdu.data);
    return emptyOk();
  }
  if (V7_EMPTY_P1.has(apdu.p1)) {
    remember(openTx(session, 'v7', false), apdu.data);
    return emptyOk();
  }
  if (apdu.p1 === V7_CONFIRM) {
    const tx = openTx(session, 'v7', false);
    remember(tx, apdu.data);
    const ok = await confirmTx(ctx, tx.body);
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    tx.hash = txHash(tx.body);
    return encodeResponse(tx.hash, SW_OK);
  }
  if (apdu.p1 === V7_WITNESS) {
    return signWitness(apdu, ctx, session, 'v7');
  }
  return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
}

async function confirmTx(ctx: FamilyContext, body: Uint8Array): Promise<boolean> {
  return confirm(ctx, {
    kind: 'sign',
    title: 'Sign Cardano',
    path: 'cardano-tx',
    message: 'Sign Cardano transaction',
    rawPayload: body,
  });
}

/**
 * LedgerHQ/app-cardano `doc/apdu_reference.md` §8.1 and `src/handler/sign_opcert.c`.
 * APDU order is KES ‖ KES period ‖ issue counter ‖ path. The signed body is
 * KES ‖ issue counter ‖ KES period. `signRawMessageWithPath` signs those bytes.
 * `MAX_OPCERT_LENGTH` is 32 + 8 + 8 + sizeof(bip44_path_t). That struct is 24 bytes.
 */
const MAX_OPCERT_LENGTH = 72;
const SW_SECURITY_CONDITION = 0x6982;
const SW_OPCERT_KES = 0x6b10;
const SW_OPCERT_PERIOD = 0x6b11;
const SW_OPCERT_COUNTER = 0x6b12;
const SW_OPCERT_PATH = 0x6b13;
const SW_OPCERT_LENGTH = 0x6b14;
/** `bip44_isPoolColdKeyPath`: m/1853'/1815'/0'/index' and the index is hardened. */
const POOL_COLD_KEY_PATH = /^m\/1853'\/1815'\/0'\/\d+'$/;

async function signOpCert(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  if (apdu.p1 !== 0x00 || apdu.p2 !== 0x00) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  const data = apdu.data;
  if (data.length > MAX_OPCERT_LENGTH) {
    return encodeResponse(new Uint8Array(), SW_OPCERT_LENGTH);
  }
  if (data.length < 32) {
    return encodeResponse(new Uint8Array(), SW_OPCERT_KES);
  }
  if (data.length < 40) {
    return encodeResponse(new Uint8Array(), SW_OPCERT_PERIOD);
  }
  if (data.length < 48) {
    return encodeResponse(new Uint8Array(), SW_OPCERT_COUNTER);
  }
  let parsed: { path: string; rest: Uint8Array };
  try {
    parsed = parseBip32Path(data.subarray(48));
  } catch {
    return encodeResponse(new Uint8Array(), SW_OPCERT_PATH);
  }
  if (parsed.rest.length !== 0) {
    return encodeResponse(new Uint8Array(), SW_OPCERT_LENGTH);
  }
  if (!POOL_COLD_KEY_PATH.test(parsed.path)) {
    return encodeResponse(new Uint8Array(), SW_SECURITY_CONDITION);
  }
  const path = ctx.confirmation.resolvePath?.(parsed.path, ['ada']) ?? parsed.path;
  const signedBody = concatBytes(
    data.subarray(0, 32),
    data.subarray(40, 48),
    data.subarray(32, 40),
  );
  const ok = await confirm(ctx, {
    kind: 'sign',
    title: 'Sign Cardano op cert',
    path,
    message: `Sign Cardano operational certificate\n${path}`,
    rawPayload: signedBody,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const node = await icarusAt(ctx, path);
  return encodeResponse(signIcarus(node, signedBody), SW_OK);
}

/**
 * LedgerHQ/app-cardano §9.1, `src/handler/sign_cvote.c`, and
 * `src/cvote/vote_cast_hash_builder.c`. The hash is blake2b-256 of the raw
 * votecast bytes. The 4-byte length prefix is not hashed.
 */
const CVOTE_CHUNK = 250;
const SW_WRONG_DATA = 0x6a87;
const SW_NOT_ALLOWED = 0x6980;
const SW_CVOTE_PLAN = 0x6b51;
const SW_CVOTE_INDEX = 0x6b52;
const SW_CVOTE_TAG = 0x6b53;
const SW_CVOTE_LENGTH = 0x6b54;
const SW_BIP44_PATH = 0x6b05;
/** `bip44_isCVoteKeyPath`: m/1694'/1815'/account'/0/address, address not hardened. */
const CVOTE_WITNESS_PATH = /^m\/1694'\/1815'\/\d+'\/0\/\d+$/;

function cvoteFail(session: CardanoSession, sw: number): Uint8Array {
  session.cardanoCvote = undefined;
  return encodeResponse(new Uint8Array(), sw);
}

async function signCvote(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array> {
  const p1 = apdu.p1;
  if (apdu.p2 !== 0x00 || (p1 !== 0x50 && p1 !== 0x51 && p1 !== 0x52)) {
    return cvoteFail(session, SW_WRONG_P1P2);
  }
  if (p1 === 0x50) {
    return cvoteInit(apdu, session);
  }
  if (p1 === 0x51) {
    return cvoteChunk(apdu, session);
  }
  return cvoteConfirm(apdu, ctx, session);
}

function cvoteInit(apdu: Apdu, session: CardanoSession): Uint8Array {
  if (session.cardanoCvote) {
    return cvoteFail(session, SW_NOT_ALLOWED);
  }
  if (apdu.data.length < 4) {
    return encodeResponse(new Uint8Array(), SW_CVOTE_LENGTH);
  }
  const total = readU32BE(apdu.data, 0);
  if (total === 0) {
    return encodeResponse(new Uint8Array(), SW_WRONG_DATA);
  }
  const chunk = apdu.data.subarray(4);
  if (chunk.length > total || chunk.length !== Math.min(total, CVOTE_CHUNK)) {
    return encodeResponse(new Uint8Array(), SW_WRONG_DATA);
  }
  if (chunk.length < 32) {
    return encodeResponse(new Uint8Array(), SW_CVOTE_PLAN);
  }
  if (chunk.length < 33) {
    return encodeResponse(new Uint8Array(), SW_CVOTE_INDEX);
  }
  if (chunk.length < 34) {
    return encodeResponse(new Uint8Array(), SW_CVOTE_TAG);
  }
  const remaining = total - chunk.length;
  session.cardanoCvote = {
    state: remaining === 0 ? 'confirm' : 'chunk',
    remaining,
    body: chunk.slice(),
  };
  return emptyOk();
}

function cvoteChunk(apdu: Apdu, session: CardanoSession): Uint8Array {
  const vote = session.cardanoCvote;
  if (!vote || vote.state !== 'chunk') {
    return cvoteFail(session, SW_NOT_ALLOWED);
  }
  const expected = Math.min(vote.remaining, CVOTE_CHUNK);
  if (apdu.data.length !== expected) {
    return cvoteFail(session, SW_WRONG_DATA);
  }
  const remaining = vote.remaining - apdu.data.length;
  vote.body = concatBytes(vote.body, apdu.data);
  vote.remaining = remaining;
  vote.state = remaining === 0 ? 'confirm' : 'chunk';
  return emptyOk();
}

async function cvoteConfirm(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array> {
  const vote = session.cardanoCvote;
  if (!vote || vote.state !== 'confirm') {
    return cvoteFail(session, SW_NOT_ALLOWED);
  }
  let parsed: { path: string; rest: Uint8Array };
  if (apdu.data.length < 1 || apdu.data[0] === 0 || apdu.data[0] > 5) {
    return cvoteFail(session, SW_BIP44_PATH);
  }
  try {
    parsed = parseBip32Path(apdu.data);
  } catch {
    return cvoteFail(session, SW_BIP44_PATH);
  }
  if (parsed.rest.length !== 0) {
    return cvoteFail(session, SW_WRONG_DATA);
  }
  if (!CVOTE_WITNESS_PATH.test(parsed.path)) {
    return cvoteFail(session, SW_SECURITY_CONDITION);
  }
  const path = ctx.confirmation.resolvePath?.(parsed.path, ['ada']) ?? parsed.path;
  const ok = await confirm(ctx, {
    kind: 'sign',
    title: 'Sign Cardano vote',
    path,
    message: `Sign Cardano CIP-36 vote\n${path}`,
    rawPayload: vote.body,
  });
  if (!ok) {
    return cvoteFail(session, SW_DENY);
  }
  const hash = blake2b(vote.body, { dkLen: 32 });
  const node = await icarusAt(ctx, path);
  session.cardanoCvote = undefined;
  return encodeResponse(concatBytes(hash, signIcarus(node, hash)), SW_OK);
}

async function signWitness(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
  protocol: 'v7' | 'v8',
): Promise<Uint8Array> {
  const tx = session.cardanoTx;
  if (!tx || tx.protocol !== protocol || !tx.hash) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  let path: string;
  try {
    path = parseBip32Path(apdu.data).path;
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  path = ctx.confirmation.resolvePath?.(path, ['ada']) ?? path;
  const ok = await confirm(ctx, {
    kind: 'sign',
    title: 'Sign Cardano witness',
    path,
    message: `Sign Cardano witness\n${path}`,
    rawPayload: tx.hash,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const node = await icarusAt(ctx, path);
  return encodeResponse(signIcarus(node, tx.hash), SW_OK);
}

async function exportExtPubkey(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  const path = parsePath(apdu, ctx);
  const ok = await confirm(ctx, {
    kind: 'address',
    title: 'Export Cardano key',
    path,
    message: `Export Cardano extended public key (CIP-3 Icarus)\n${path}`,
    rawPayload: apdu.data,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const node = await icarusAt(ctx, path);
  return encodeResponse(concatBytes(node.publicKey, node.chainCode), SW_OK);
}

async function exportAddress(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  const path = parsePath(apdu, ctx);
  const ok = await confirm(ctx, {
    kind: 'address',
    title: 'Export Cardano address',
    path,
    message: `Export Cardano enterprise address (CIP-3 Icarus)\n${path}`,
    rawPayload: apdu.data,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const node = await icarusAt(ctx, path);
  return encodeResponse(encodePubAndAddress(node.publicKey, cardanoEnterprise(node.publicKey)), SW_OK);
}

function parsePath(apdu: Apdu, ctx: FamilyContext): string {
  const path = parseBip32PathSafe(apdu.data).path;
  return ctx.confirmation.resolvePath?.(path, ['ada']) ?? path;
}

function parseBip32PathSafe(data: Uint8Array): { path: string; rest: Uint8Array } {
  try {
    return parseBip32Path(data);
  } catch {
    return { path: "m/1852'/1815'/0'/0/0", rest: data };
  }
}

async function icarusAt(ctx: FamilyContext, path: string) {
  const root = await icarusRootFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  if (root) {
    return deriveIcarusFromRoot(root, path);
  }
  return deriveIcarus(ctx.entropy, path, undefined, ctx.backup);
}

async function confirm(
  ctx: FamilyContext,
  request: Omit<SigningRequest, 'brand'>,
): Promise<boolean> {
  return ctx.confirmation.confirm({ brand: 'ledger', ...request });
}
