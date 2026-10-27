import { bech32, bech32m, base58check as createBase58check } from '@scure/base';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import type { BackupKind, ChainPathId, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { catalogVersion, describeBtcPsbt } from '@cws/contracts';
import { concatBytes, encodeAscii } from '../bytes';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { scriptToAddress } from '@cws/protocol-qr';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  type Apdu,
} from '../apdu';
import {
  deriveHdNodeFromSeed,
  derivePrivateKeyFromSeed,
  publicKeyCompressed,
  seedFor,
  signSecp256k1Recoverable,
  type HdNode,
} from '../crypto';
import { encodeDerSignature } from './addresses';
import { encodeAppAndVersion } from './dashboard';
import { bip143Sighash, p2wpkhScriptCode, u32le } from './psbt';

export const BITCOIN_APP_VERSION = catalogVersion('bitcoin', '2.4.2');

const b58c = createBase58check(sha256);
const SECP_N = secp256k1.CURVE.n;

export type BtcCoin = 'bitcoin' | 'litecoin' | 'dogecoin' | 'bitcoin-test';

const COIN: Record<BtcCoin, { name: string; p2pkh: number; p2sh: number; hrp: string | null }> = {
  bitcoin: { name: 'Bitcoin', p2pkh: 0x00, p2sh: 0x05, hrp: 'bc' },
  'bitcoin-test': { name: 'Bitcoin Test', p2pkh: 0x6f, p2sh: 0xc4, hrp: 'tb' },
  litecoin: { name: 'Litecoin', p2pkh: 0x30, p2sh: 0x32, hrp: 'ltc' },
  dogecoin: { name: 'Dogecoin', p2pkh: 0x1e, p2sh: 0x16, hrp: null },
};

export type BtcPrevout = {
  prevout: Uint8Array;
  amount: bigint;
  sequence: number;
};

export type BtcSession = {
  version?: number;
  prevouts?: BtcPrevout[];
  prevout?: Uint8Array;
  amount?: bigint;
  sequence?: number;
  outputs?: Uint8Array;
  locktime?: number;
  signIndex?: number;
  clientPsbt?: Uint8Array;
  clientJob?: {
    gen: Generator<{ interrupt: Uint8Array } | { confirm: SigningRequest }, Uint8Array, Uint8Array | boolean>;
  };
  registeredWallets?: Map<string, { serialize: Uint8Array; hmac: Uint8Array; template: string; keysInfo: string[] }>;
};

export type BtcContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  coin?: BtcCoin;
  session?: BtcSession;
};

export function coinFromAppId(id: string): BtcCoin {
  const value = id.toLowerCase();
  if (value.includes('lite')) {
    return 'litecoin';
  }
  if (value.includes('doge')) {
    return 'dogecoin';
  }
  if (value.includes('test')) {
    return 'bitcoin-test';
  }
  return 'bitcoin';
}

export function getBitcoinAppAndVersion(coin: BtcCoin = 'bitcoin'): Uint8Array {
  const meta = COIN[coin];
  return encodeAppAndVersion(meta.name, catalogVersion(coin === 'bitcoin' ? 'bitcoin' : coin, BITCOIN_APP_VERSION));
}

export async function handleBitcoinApdu(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  switch (apdu.ins) {
    case 0x40:
      return handleGetWalletPublicKey(apdu, ctx);
    case 0x44:
      return handleTxInputStart(apdu, ctx);
    case 0x4a:
      return handleTxFinalize(apdu, ctx);
    case 0x48:
      return handleUntrustedHashSign(apdu, ctx);
    case 0x4e:
      return handleSignMessage(apdu, ctx);
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

export function bitcoinAddressFor(node: HdNode, path: string, p2: number, coin: BtcCoin = 'bitcoin'): string {
  const meta = COIN[coin];
  if ((p2 === 0x04 || path.startsWith("m/86'/")) && meta.hrp) {
    return bitcoinP2tr(node.privateKey, meta.hrp);
  }
  if ((p2 === 0x02 || path.startsWith("m/84'/")) && meta.hrp) {
    return bitcoinP2wpkh(node.publicKey, meta.hrp);
  }
  if (p2 === 0x01 || path.startsWith("m/49'/")) {
    return bitcoinP2shP2wpkh(node.publicKey, meta.p2sh);
  }
  return bitcoinP2pkh(node.publicKey, meta.p2pkh);
}

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

export function bitcoinP2pkh(publicKey: Uint8Array, version = 0x00): string {
  return b58c.encode(concatBytes(Uint8Array.of(version), hash160(publicKey)));
}

export function bitcoinP2shP2wpkh(publicKey: Uint8Array, version = 0x05): string {
  const redeem = concatBytes(Uint8Array.of(0x00, 0x14), hash160(publicKey));
  return b58c.encode(concatBytes(Uint8Array.of(version), hash160(redeem)));
}

export function bitcoinP2wpkh(publicKey: Uint8Array, hrp = 'bc'): string {
  const words = bech32.toWords(hash160(publicKey));
  return bech32.encode(hrp, [0, ...words]);
}

function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  return sha256(concatBytes(tagHash, tagHash, data));
}

function bytesToBig(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}

function bigToBytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let n = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function evenPriv(priv: Uint8Array): { priv: Uint8Array; xOnly: Uint8Array } {
  const pub = secp256k1.getPublicKey(priv, true);
  const xOnly = pub.subarray(1);
  if (pub[0] === 0x02) {
    return { priv, xOnly };
  }
  return { priv: bigToBytes32((SECP_N - bytesToBig(priv)) % SECP_N), xOnly };
}

export function bitcoinP2tr(privateKey: Uint8Array, hrp = 'bc'): string {
  const even = evenPriv(privateKey);
  const tweak = bytesToBig(taggedHash('TapTweak', even.xOnly)) % SECP_N;
  const tweaked = (bytesToBig(even.priv) + tweak) % SECP_N;
  const output = schnorr.getPublicKey(bigToBytes32(tweaked));
  return bech32m.encode(hrp, [1, ...bech32m.toWords(output)]);
}

function btcChains(coin: BtcCoin): readonly ChainPathId[] {
  if (coin === 'litecoin') {
    return ['ltc'];
  }
  if (coin === 'dogecoin') {
    return ['doge'];
  }
  return ['btc-legacy', 'btc-nested', 'btc-native', 'btc-taproot'];
}

function btcPath(ctx: BtcContext, path: string): string {
  return ctx.confirmation.resolvePath?.(path, btcChains(ctx.coin ?? 'bitcoin')) ?? path;
}

async function handleGetWalletPublicKey(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  const coin = ctx.coin ?? 'bitcoin';
  const { path: apduPath } = parseBip32Path(apdu.data);
  const path = btcPath(ctx, apduPath);
  if (apdu.p1 !== 0x00) {
    const request: SigningRequest = {
      brand: 'ledger',
      kind: 'address',
      title: `Export ${COIN[coin].name} key`,
      path,
      message: `Export ${COIN[coin].name} public key\n${path}`,
      rawPayload: apdu.data,
    };
    const ok = await ctx.confirmation.confirm(request);
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = deriveHdNodeFromSeed(seed, path);
  const address = bitcoinAddressFor(node, path, apdu.p2, coin);
  const addressBytes = encodeAscii(address);
  const body = concatBytes(
    Uint8Array.of(node.publicKey.length),
    node.publicKey,
    Uint8Array.of(addressBytes.length),
    addressBytes,
    node.chainCode,
  );
  return encodeResponse(body, SW_OK);
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readU64le(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    value = (value << 8n) + BigInt(bytes[offset + i]);
  }
  return value;
}

function handleTxInputStart(apdu: Apdu, ctx: BtcContext): Uint8Array {
  if (apdu.data.length < 52) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const session = ctx.session;
  if (!session) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const item: BtcPrevout = {
    prevout: apdu.data.subarray(4, 40).slice(),
    amount: readU64le(apdu.data, 40),
    sequence: readU32le(apdu.data, 48),
  };
  if (apdu.p1 === 0x00 || !session.prevouts) {
    session.prevouts = [];
    session.signIndex = 0;
  }
  session.prevouts.push(item);
  session.version = readU32le(apdu.data, 0);
  session.prevout = item.prevout;
  session.amount = item.amount;
  session.sequence = item.sequence;
  return encodeResponse(new Uint8Array(), SW_OK);
}

function handleTxFinalize(apdu: Apdu, ctx: BtcContext): Uint8Array {
  if (apdu.data.length === 0) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const session = ctx.session;
  if (!session) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  session.outputs = apdu.data.slice();
  return encodeResponse(new Uint8Array(), SW_OK);
}

function parseOutputBodies(bytes: Uint8Array): Array<{ amountSats: bigint; address: string }> {
  const outputs: Array<{ amountSats: bigint; address: string }> = [];
  let offset = 0;
  while (offset + 9 <= bytes.length) {
    const amountSats = readU64le(bytes, offset);
    offset += 8;
    const scriptLen = bytes[offset]!;
    offset += 1;
    if (offset + scriptLen > bytes.length) {
      break;
    }
    const script = bytes.subarray(offset, offset + scriptLen);
    offset += scriptLen;
    outputs.push({ amountSats, address: scriptToAddress(script) });
  }
  return outputs;
}

async function handleUntrustedHashSign(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  const coin = ctx.coin ?? 'bitcoin';
  let path = 'm';
  let rest = apdu.data;
  try {
    const parsed = parseBip32Path(apdu.data);
    path = btcPath(ctx, parsed.path);
    rest = parsed.rest;
  } catch {
    rest = apdu.data;
  }
  const session = ctx.session;
  const prevouts = session?.prevouts?.length
    ? session.prevouts
    : session?.prevout && session.amount != null
      ? [{ prevout: session.prevout, amount: session.amount, sequence: session.sequence ?? 0xffffffff }]
      : [];
  const assembled = prevouts.length > 0 && session?.outputs && session.version != null;
  let hash: Uint8Array | null = null;
  if (assembled && session) {
    session.locktime = rest.length >= 4 ? readU32le(rest, 0) : 0;
  }
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: assembled ? `Sign ${COIN[coin].name} transaction` : `Sign ${COIN[coin].name} hash`,
    path,
    message: assembled
      ? `Sign ${COIN[coin].name} transaction\n${path}`
      : `Sign ${COIN[coin].name} 32-byte hash\n${path}`,
    rawPayload: assembled ? prevouts[0]!.prevout : rest,
    detail:
      assembled && session?.outputs
        ? describeBtcPsbt({
            path,
            outputs: parseOutputBodies(session.outputs),
            feeSats: prevouts.reduce((sum, item) => sum + item.amount, 0n) - parseOutputBodies(session.outputs).reduce((sum, item) => sum + item.amountSats, 0n),
          })
        : undefined,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const privateKey = derivePrivateKeyFromSeed(seed, path);
  if (assembled && session?.outputs && session.version != null) {
    const pub = publicKeyCompressed(privateKey);
    const index = Math.min(session.signIndex ?? 0, prevouts.length - 1);
    const current = prevouts[index]!;
    hash = bip143Sighash({
      version: session.version,
      prevout: current.prevout,
      prevouts: concatBytes(...prevouts.map((item) => item.prevout)),
      sequences: concatBytes(...prevouts.map((item) => u32le(item.sequence))),
      amount: current.amount,
      sequence: current.sequence,
      scriptCode: p2wpkhScriptCode(hash160(pub)),
      outputs: session.outputs,
      locktime: session.locktime ?? 0,
    });
    session.signIndex = (session.signIndex ?? 0) + 1;
    if ((session.signIndex ?? 0) >= prevouts.length) {
      session.prevout = undefined;
      session.prevouts = undefined;
      session.outputs = undefined;
      session.signIndex = 0;
    }
  } else {
    hash = extractHash32(rest);
  }
  if (!hash) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const compact = secp256k1.sign(hash, privateKey).toCompactRawBytes();
  return encodeResponse(concatBytes(encodeDerSignature(compact), Uint8Array.of(0x01)), SW_OK);
}

function extractHash32(rest: Uint8Array): Uint8Array | null {
  if (rest.length === 32) {
    return rest;
  }
  if (rest.length === 33) {
    return rest.subarray(1);
  }
  if (rest.length > 32) {
    return rest.subarray(rest.length - 32);
  }
  return null;
}

async function handleSignMessage(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  const coin = ctx.coin ?? 'bitcoin';
  const parsed = parseBip32Path(apdu.data);
  const path = btcPath(ctx, parsed.path);
  const rest = parsed.rest;
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: `Sign ${COIN[coin].name} message`,
    path,
    message: `Sign ${COIN[coin].name} message\n${path}`,
    rawPayload: rest,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const privateKey = derivePrivateKeyFromSeed(seed, path);
  const prefix = encodeAscii('\x18Bitcoin Signed Message:\n');
  const compact =
    rest.length < 0xfd
      ? Uint8Array.of(rest.length)
      : concatBytes(Uint8Array.of(0xfd, rest.length & 0xff, (rest.length >> 8) & 0xff));
  const hash = sha256(sha256(concatBytes(prefix, compact, rest)));
  return encodeResponse(signSecp256k1Recoverable(privateKey, hash), SW_OK);
}
