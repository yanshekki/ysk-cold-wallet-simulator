import { HDKey } from '@scure/bip32';
import { describeBtcPsbt } from '@cws/contracts';
import type { SigningRequest } from '@cws/contracts';
import { parsePsbt, previewPsbt, signPsbtBytes } from '@cws/protocol-qr';
import { sha256 } from '@noble/hashes/sha2';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  type Apdu,
} from '../apdu';
import { concatBytes, encodeAscii, readU32BE } from '../bytes';
import { deriveHdNodeFromSeed, derivePrivateKeyFromSeed, seedFor, signSecp256k1Recoverable } from '../crypto';
import { bitcoinAddressFor, type BtcContext, type BtcSession } from './bitcoin';
import {
  CLA_FRAMEWORK,
  ClientCommand,
  INS_CONTINUE,
  SW_INTERRUPTED,
  bytesEqual,
  fromHex,
  hexOf,
  parseMapCommitment,
  readVarint,
  verifyLeafProof,
  writeVarint,
  type ByteMap,
} from './merkle';
import {
  addressFromPolicy,
  isDefaultTemplate,
  parseWalletHeader,
  walletHmac,
  walletIdOf,
} from './walletPolicy';

export { CLA_FRAMEWORK, INS_CONTINUE, SW_INTERRUPTED };

const INS = {
  GET_EXTENDED_PUBKEY: 0x00,
  REGISTER_WALLET: 0x02,
  GET_WALLET_ADDRESS: 0x03,
  SIGN_PSBT: 0x04,
  GET_MASTER_FINGERPRINT: 0x05,
  SIGN_MESSAGE: 0x10,
} as const;

const MAGIC = Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff);
const DEFAULT_NATIVE = "m/84'/0'/0'/0/0";
const utf8 = new TextDecoder();

export type JobYield = { interrupt: Uint8Array } | { confirm: SigningRequest };

export type ClientJob = {
  gen: Generator<JobYield, Uint8Array, Uint8Array | boolean>;
};

export type RegisteredWallet = {
  serialize: Uint8Array;
  hmac: Uint8Array;
  template: string;
  keysInfo: string[];
};

function looksLikePsbt(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3] &&
    bytes[4] === MAGIC[4]
  );
}

function parseClientPath(data: Uint8Array): { display: boolean; path: string; rest: Uint8Array } {
  if (data.length === 0) {
    return { display: false, path: DEFAULT_NATIVE, rest: data };
  }
  if (
    (data[0] === 0x00 || data[0] === 0x01) &&
    data.length >= 2 &&
    data[1]! <= 10 &&
    2 + data[1]! * 4 <= data.length
  ) {
    const parsed = parseBip32Path(data.subarray(1));
    return { display: data[0] === 0x01, path: parsed.path, rest: parsed.rest };
  }
  const parsed = parseBip32Path(data);
  return { display: false, path: parsed.path, rest: parsed.rest };
}

function masterNode(seed: Uint8Array): HDKey {
  return HDKey.fromMasterSeed(seed);
}

function sessionOf(ctx: BtcContext): BtcSession {
  if (!ctx.session) {
    ctx.session = {};
  }
  return ctx.session;
}

function* request(body: Uint8Array): Generator<JobYield, Uint8Array, Uint8Array | boolean> {
  const reply = yield { interrupt: body };
  if (typeof reply === 'boolean' || !reply) {
    throw new Error('expected CONTINUE data');
  }
  return reply;
}

function* fetchPreimage(hash: Uint8Array): Generator<JobYield, Uint8Array, Uint8Array | boolean> {
  const first = yield* request(concatBytes(Uint8Array.of(ClientCommand.GET_PREIMAGE, 0x00), hash));
  const length = readVarint(first, 0);
  const prefix = first[length.next] ?? 0;
  let collected = first.subarray(length.next + 1, length.next + 1 + prefix);
  while (collected.length < length.value) {
    const more = yield* request(Uint8Array.of(ClientCommand.GET_MORE_ELEMENTS));
    const count = more[0] ?? 0;
    const size = more[1] ?? 0;
    collected = concatBytes(collected, more.subarray(2, 2 + count * size));
  }
  if (!bytesEqual(sha256(collected), hash)) {
    throw new Error('preimage mismatch');
  }
  return collected;
}

function* fetchLeaf(
  root: Uint8Array,
  size: number,
  index: number,
): Generator<JobYield, Uint8Array, Uint8Array | boolean> {
  const first = yield* request(
    concatBytes(Uint8Array.of(ClientCommand.GET_MERKLE_LEAF_PROOF), root, writeVarint(size), writeVarint(index)),
  );
  const leaf = first.subarray(0, 32);
  const proofLen = first[32] ?? 0;
  const packed = first[33] ?? 0;
  const proof: Uint8Array[] = [];
  let offset = 34;
  for (let i = 0; i < packed; i += 1) {
    proof.push(first.subarray(offset, offset + 32));
    offset += 32;
  }
  while (proof.length < proofLen) {
    const more = yield* request(Uint8Array.of(ClientCommand.GET_MORE_ELEMENTS));
    const count = more[0] ?? 0;
    const elemSize = more[1] ?? 32;
    offset = 2;
    for (let i = 0; i < count; i += 1) {
      proof.push(more.subarray(offset, offset + elemSize));
      offset += elemSize;
    }
  }
  if (!verifyLeafProof(leaf, index, size, proof, root)) {
    throw new Error('invalid merkle proof');
  }
  return leaf;
}

function* fetchList(root: Uint8Array, size: number): Generator<JobYield, Uint8Array[], Uint8Array | boolean> {
  const out: Uint8Array[] = [];
  for (let index = 0; index < size; index += 1) {
    const leaf = yield* fetchLeaf(root, size, index);
    const preimage = yield* fetchPreimage(leaf);
    if (preimage[0] !== 0x00) {
      throw new Error('expected 0x00-prefixed merkle leaf');
    }
    out.push(preimage.subarray(1));
  }
  return out;
}

function* fetchMap(size: number, keysRoot: Uint8Array, valuesRoot: Uint8Array): Generator<JobYield, ByteMap, Uint8Array | boolean> {
  const keys = yield* fetchList(keysRoot, size);
  const values = yield* fetchList(valuesRoot, size);
  return keys.map((key, index) => [key, values[index] ?? new Uint8Array()]);
}

function* fetchWallet(walletId: Uint8Array): Generator<JobYield, { serialize: Uint8Array; template: string; keysInfo: string[] }, Uint8Array | boolean> {
  const serialize = yield* fetchPreimage(walletId);
  const header = parseWalletHeader(serialize);
  let template = header.descriptorTemplate ?? '';
  if (!template && header.descriptorTemplateHash) {
    template = utf8.decode(yield* fetchPreimage(header.descriptorTemplateHash));
  }
  const keysInfo = (yield* fetchList(header.keysRoot, header.nKeys)).map((bytes) => utf8.decode(bytes));
  return { serialize, template, keysInfo };
}

function writeMap(map: Map<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [keyHex, value] of map) {
    const key = fromHex(keyHex);
    parts.push(writeVarint(key.length), key, writeVarint(value.length), value);
  }
  parts.push(Uint8Array.of(0x00));
  return concatBytes(...parts);
}

function mapsToPsbt(global: ByteMap, inputs: ByteMap[], outputs: ByteMap[]): Uint8Array {
  const toMap = (entries: ByteMap) => new Map(entries.map(([key, value]) => [hexOf(key), value]));
  return concatBytes(MAGIC, writeMap(toMap(global)), ...inputs.map((entry) => writeMap(toMap(entry))), ...outputs.map((entry) => writeMap(toMap(entry))));
}

function collectYields(signed: Uint8Array): Uint8Array[] {
  const parsed = parsePsbt(signed);
  const yielded: Uint8Array[] = [];
  parsed.inputMaps.forEach((map, index) => {
    const tap = map.get('13');
    if (tap) {
      const xonly = map.get('17') ?? new Uint8Array(32);
      yielded.push(concatBytes(writeVarint(index), Uint8Array.of(xonly.length), xonly, tap));
      return;
    }
    for (const [key, signature] of map) {
      if (key.startsWith('02') && key.length === 68) {
        const pub = fromHex(key.slice(2));
        yielded.push(concatBytes(writeVarint(index), Uint8Array.of(pub.length), pub, signature));
      }
    }
  });
  return yielded;
}

function hmacZeros(bytes: Uint8Array): boolean {
  return bytes.length === 32 && bytes.every((byte) => byte === 0);
}

function* signPsbtJob(
  data: Uint8Array,
  seed: Uint8Array,
): Generator<JobYield, Uint8Array, Uint8Array | boolean> {
  const globalCommit = parseMapCommitment(data, 0);
  const nIn = readVarint(data, globalCommit.next);
  const inputsRoot = data.subarray(nIn.next, nIn.next + 32);
  const nOut = readVarint(data, nIn.next + 32);
  const outputsRoot = data.subarray(nOut.next, nOut.next + 32);
  const walletId = data.subarray(nOut.next + 32, nOut.next + 64);
  const walletHmacBytes = data.subarray(nOut.next + 64, nOut.next + 96);
  if (inputsRoot.length !== 32 || outputsRoot.length !== 32 || walletId.length !== 32 || walletHmacBytes.length !== 32) {
    throw new Error('truncated SIGN_PSBT');
  }
  const global = yield* fetchMap(globalCommit.size, globalCommit.keysRoot, globalCommit.valuesRoot);
  const inputCommitments = yield* fetchList(inputsRoot, nIn.value);
  const outputCommitments = yield* fetchList(outputsRoot, nOut.value);
  const inputs: ByteMap[] = [];
  for (const commitment of inputCommitments) {
    const parsed = parseMapCommitment(commitment, 0);
    inputs.push(yield* fetchMap(parsed.size, parsed.keysRoot, parsed.valuesRoot));
  }
  const outputs: ByteMap[] = [];
  for (const commitment of outputCommitments) {
    const parsed = parseMapCommitment(commitment, 0);
    outputs.push(yield* fetchMap(parsed.size, parsed.keysRoot, parsed.valuesRoot));
  }
  const wallet = yield* fetchWallet(walletId);
  if (!isDefaultTemplate(wallet.template)) {
    throw new Error('unsupported wallet policy');
  }
  const hmacUnchecked = hmacZeros(walletHmacBytes);
  if (!hmacUnchecked && !bytesEqual(walletHmacBytes, walletHmac(seed, wallet.serialize))) {
    throw new Error('bad wallet hmac');
  }
  const psbt = mapsToPsbt(global, inputs, outputs);
  const preview = previewPsbt(seed, psbt);
  const uncheckedPolicy = hmacUnchecked ? wallet.template : undefined;
  const ok = yield {
    confirm: {
      brand: 'ledger',
      kind: 'sign',
      title: 'Sign Bitcoin transaction',
      path: preview.path,
      message: uncheckedPolicy
        ? `Sign Bitcoin transaction\n${preview.path}\n${uncheckedPolicy}`
        : `Sign Bitcoin transaction\n${preview.path}`,
      rawPayload: psbt,
      detail: describeBtcPsbt({
        path: preview.path,
        outputs: preview.outputs,
        feeSats: preview.feeSats,
        uncheckedPolicy,
      }),
    },
  };
  if (!ok) {
    throw new Error('denied');
  }
  const signed = signPsbtBytes(seed, psbt);
  for (const payload of collectYields(signed.psbt)) {
    yield* request(concatBytes(Uint8Array.of(ClientCommand.YIELD), payload));
  }
  return new Uint8Array();
}

function* registerWalletJob(
  serialize: Uint8Array,
  seed: Uint8Array,
): Generator<JobYield, Uint8Array, Uint8Array | boolean> {
  const wallet = yield* fetchWallet(walletIdOf(serialize));
  if (!isDefaultTemplate(wallet.template)) {
    throw new Error('unsupported wallet policy');
  }
  const ok = yield {
    confirm: {
      brand: 'ledger',
      kind: 'address',
      title: 'Register Bitcoin wallet',
      path: wallet.template,
      message: `Register Bitcoin wallet\n${wallet.template}\n${wallet.keysInfo[0] ?? ''}`,
      rawPayload: serialize,
    },
  };
  if (!ok) {
    throw new Error('denied');
  }
  const hmacBytes = walletHmac(seed, serialize);
  return concatBytes(walletIdOf(serialize), hmacBytes);
}

function* getWalletAddressJob(
  display: boolean,
  walletId: Uint8Array,
  hmacBytes: Uint8Array,
  change: number,
  addressIndex: number,
  seed: Uint8Array,
  coin: BtcContext['coin'],
): Generator<JobYield, Uint8Array, Uint8Array | boolean> {
  const wallet = yield* fetchWallet(walletId);
  if (!isDefaultTemplate(wallet.template)) {
    throw new Error('unsupported wallet policy');
  }
  if (!hmacZeros(hmacBytes) && !bytesEqual(hmacBytes, walletHmac(seed, wallet.serialize))) {
    throw new Error('bad wallet hmac');
  }
  const derived = addressFromPolicy(seed, wallet.template, wallet.keysInfo, change, addressIndex, coin ?? 'bitcoin');
  if (display) {
    const ok = yield {
      confirm: {
        brand: 'ledger',
        kind: 'address',
        title: 'Export Bitcoin address',
        path: derived.path,
        message: `Export Bitcoin address\n${derived.path}\n${derived.address}`,
        rawPayload: walletId,
      },
    };
    if (!ok) {
      throw new Error('denied');
    }
  }
  // Ledger's Bitcoin client returns the address as raw ASCII. A length prefix
  // becomes the first character (`"` / `*` / `>`) and OKX rejects it as 地址格式錯誤.
  return encodeAscii(derived.address);
}

function* signMessageJob(
  path: string,
  length: number,
  root: Uint8Array,
): Generator<JobYield, { path: string; message: Uint8Array }, Uint8Array | boolean> {
  const chunks = Math.max(1, Math.ceil(length / 64));
  const parts = yield* fetchList(root, chunks);
  const message = concatBytes(...parts).subarray(0, length);
  return { path, message };
}

async function runClientJob(
  ctx: BtcContext,
  job: ClientJob,
  input?: Uint8Array | boolean,
): Promise<Uint8Array> {
  sessionOf(ctx).clientJob = job;
  let step = input === undefined ? job.gen.next() : job.gen.next(input);
  while (true) {
    if (step.done) {
      sessionOf(ctx).clientJob = undefined;
      return encodeResponse(step.value, SW_OK);
    }
    const yielded = step.value;
    if ('interrupt' in yielded) {
      return encodeResponse(yielded.interrupt, SW_INTERRUPTED);
    }
    const ok = await ctx.confirmation.confirm(yielded.confirm);
    if (!ok) {
      sessionOf(ctx).clientJob = undefined;
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    step = job.gen.next(true);
  }
}

function failJob(ctx: BtcContext): Uint8Array {
  sessionOf(ctx).clientJob = undefined;
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}

export async function handleBitcoinContinue(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  const job = ctx.session?.clientJob;
  if (!job) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  try {
    return await runClientJob(ctx, job, apdu.data);
  } catch {
    return failJob(ctx);
  }
}

export async function handleBitcoinClientApdu(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  if (apdu.cla === CLA_FRAMEWORK && apdu.ins === INS_CONTINUE) {
    return handleBitcoinContinue(apdu, ctx);
  }
  switch (apdu.ins) {
    case INS.GET_EXTENDED_PUBKEY:
      return handleGetExtendedPubkey(apdu, ctx);
    case INS.GET_MASTER_FINGERPRINT:
      return handleGetMasterFingerprint(ctx);
    case INS.GET_WALLET_ADDRESS:
      return handleGetWalletAddress(apdu, ctx);
    case INS.SIGN_PSBT:
      return handleSignPsbt(apdu, ctx);
    case INS.SIGN_MESSAGE:
      return handleSignMessage(apdu, ctx);
    case INS.REGISTER_WALLET:
      return handleRegisterWallet(apdu, ctx);
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

async function handleGetExtendedPubkey(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  let parsed;
  try {
    parsed = parseClientPath(apdu.data);
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const path = ctx.confirmation.resolvePath?.(parsed.path, ['btc-legacy', 'btc-nested', 'btc-native', 'btc-taproot']) ?? parsed.path;
  if (parsed.display || apdu.p1 === 0x01 || ctx.confirmSilentPublic) {
    const ok = await ctx.confirmation.confirm({
      brand: 'ledger',
      kind: 'address',
      title: 'Export Bitcoin xpub',
      path,
      message: `Export Bitcoin xpub\n${path}`,
      rawPayload: apdu.data,
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const xpub = masterNode(seed).derive(path).publicExtendedKey;
  return encodeResponse(encodeAscii(xpub), SW_OK);
}

async function handleGetMasterFingerprint(ctx: BtcContext): Promise<Uint8Array> {
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const fingerprint = masterNode(seed).fingerprint >>> 0;
  return encodeResponse(
    Uint8Array.of(
      (fingerprint >>> 24) & 0xff,
      (fingerprint >>> 16) & 0xff,
      (fingerprint >>> 8) & 0xff,
      fingerprint & 0xff,
    ),
    SW_OK,
  );
}

function officialAddressApdu(data: Uint8Array): {
  display: boolean;
  walletId: Uint8Array;
  hmac: Uint8Array;
  change: number;
  index: number;
} | null {
  if (data.length !== 70) {
    return null;
  }
  const change = data[65];
  if (change !== 0 && change !== 1) {
    return null;
  }
  return {
    display: data[0] === 0x01,
    walletId: data.subarray(1, 33),
    hmac: data.subarray(33, 65),
    change,
    index: readU32BE(data, 66),
  };
}

async function handleGetWalletAddress(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  const official = officialAddressApdu(apdu.data);
  if (official) {
    if (!official.display && apdu.p1 !== 0x01 && ctx.confirmSilentPublic) {
      const ok = await ctx.confirmation.confirm({
        brand: 'ledger',
        kind: 'address',
        title: 'Export Bitcoin address',
        path: 'wallet',
        message: 'Export Bitcoin address',
        rawPayload: apdu.data,
      });
      if (!ok) {
        return encodeResponse(new Uint8Array(), SW_DENY);
      }
    }
    try {
      const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
      return await runClientJob(ctx, {
        gen: getWalletAddressJob(
          official.display || apdu.p1 === 0x01,
          official.walletId,
          official.hmac,
          official.change,
          official.index,
          seed,
          ctx.coin,
        ),
      });
    } catch {
      return failJob(ctx);
    }
  }
  let parsed;
  try {
    parsed = parseClientPath(apdu.data);
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const path = ctx.confirmation.resolvePath?.(parsed.path, ['btc-legacy', 'btc-nested', 'btc-native', 'btc-taproot']) ?? parsed.path;
  if (parsed.display || apdu.p1 === 0x01 || ctx.confirmSilentPublic) {
    const ok = await ctx.confirmation.confirm({
      brand: 'ledger',
      kind: 'address',
      title: 'Export Bitcoin address',
      path,
      message: `Export Bitcoin address\n${path}`,
      rawPayload: apdu.data,
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = deriveHdNodeFromSeed(seed, path);
  const p2 = path.startsWith("m/86'") ? 0x04 : path.startsWith("m/49'") ? 0x01 : path.startsWith("m/44'") ? 0x00 : 0x02;
  const address = encodeAscii(bitcoinAddressFor(node, path, p2, ctx.coin ?? 'bitcoin'));
  return encodeResponse(concatBytes(Uint8Array.of(address.length), address), SW_OK);
}

async function handleRegisterWallet(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  try {
    const length = readVarint(apdu.data, 0);
    const serialize = apdu.data.subarray(length.next, length.next + length.value);
    if (serialize.length !== length.value) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
    const result = await runClientJob(ctx, { gen: registerWalletJob(serialize, seed) });
    if (result.length >= 66) {
      const hmacBytes = result.subarray(result.length - 34, result.length - 2);
      const id = result.subarray(0, 32);
      sessionOf(ctx).registeredWallets ??= new Map();
      // store after success; result includes SW so strip later by checking SW_OK path in runClientJob
      void id;
      void hmacBytes;
    }
    return result;
  } catch {
    return failJob(ctx);
  }
}

async function handleSignPsbt(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  const session = sessionOf(ctx);
  if (apdu.p1 === 0x00) {
    session.clientPsbt = apdu.data.slice();
  } else if (apdu.p1 === 0x80 && session.clientPsbt) {
    session.clientPsbt = concatBytes(session.clientPsbt, apdu.data);
  } else if (looksLikePsbt(apdu.data) || apdu.data.length > 70) {
    session.clientPsbt = apdu.data.slice();
  } else {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const last = (apdu.p2 & 0x80) === 0;
  if (!last && looksLikePsbt(session.clientPsbt ?? new Uint8Array())) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const raw = extractPsbt(session.clientPsbt ?? new Uint8Array());
  if (raw) {
    session.clientPsbt = undefined;
    const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
    try {
      const preview = previewPsbt(seed, raw);
      const ok = await ctx.confirmation.confirm({
        brand: 'ledger',
        kind: 'sign',
        title: 'Sign Bitcoin transaction',
        path: preview.path,
        message: `Sign Bitcoin transaction\n${preview.path}`,
        rawPayload: raw,
        detail: describeBtcPsbt({
          path: preview.path,
          outputs: preview.outputs,
          feeSats: preview.feeSats,
        }),
      });
      if (!ok) {
        return encodeResponse(new Uint8Array(), SW_DENY);
      }
      const signed = signPsbtBytes(seed, raw);
      return encodeResponse(signed.psbt, SW_OK);
    } catch {
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
    }
  }
  const merklized = session.clientPsbt ?? apdu.data;
  session.clientPsbt = undefined;
  try {
    const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
    return await runClientJob(ctx, { gen: signPsbtJob(merklized, seed) });
  } catch {
    return failJob(ctx);
  }
}

function extractPsbt(bytes: Uint8Array): Uint8Array | null {
  if (looksLikePsbt(bytes)) {
    return bytes;
  }
  if (bytes.length >= 9) {
    const len = readU32BE(bytes, 0);
    const body = bytes.subarray(4);
    if (looksLikePsbt(body) && (len === body.length || len + 4 === bytes.length)) {
      return body;
    }
  }
  return null;
}

async function handleSignMessage(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  let parsed;
  try {
    parsed = parseBip32Path(apdu.data[0] === 0x00 || apdu.data[0] === 0x01 ? apdu.data.subarray(1) : apdu.data);
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const path = ctx.confirmation.resolvePath?.(parsed.path, ['btc-legacy', 'btc-nested', 'btc-native', 'btc-taproot']) ?? parsed.path;
  let message = parsed.rest;
  try {
    const length = readVarint(message, 0);
    const root = message.subarray(length.next, length.next + 32);
    if (root.length === 32 && length.next + 32 === message.length) {
      const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
      const job: ClientJob = { gen: (function* () {
        const fetched = yield* signMessageJob(path, length.value, root);
        const ok = yield {
          confirm: {
            brand: 'ledger',
            kind: 'sign',
            title: 'Sign Bitcoin message',
            path: fetched.path,
            message: `Sign Bitcoin message\n${fetched.path}`,
            rawPayload: fetched.message,
          },
        };
        if (!ok) {
          throw new Error('denied');
        }
        return bitcoinMessageSig(seed, fetched.path, fetched.message);
      })() };
      return await runClientJob(ctx, job);
    }
  } catch {
    message = parsed.rest;
  }
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign Bitcoin message',
    path,
    message: `Sign Bitcoin message\n${path}`,
    rawPayload: message,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  return encodeResponse(bitcoinMessageSig(seed, path, message), SW_OK);
}

function bitcoinMessageSig(seed: Uint8Array, path: string, message: Uint8Array): Uint8Array {
  const privateKey = derivePrivateKeyFromSeed(seed, path);
  const prefix = encodeAscii('\x18Bitcoin Signed Message:\n');
  const compact =
    message.length < 0xfd
      ? Uint8Array.of(message.length)
      : concatBytes(Uint8Array.of(0xfd, message.length & 0xff, (message.length >> 8) & 0xff));
  const hash = sha256(sha256(concatBytes(prefix, compact, message)));
  return signSecp256k1Recoverable(privateKey, hash);
}
