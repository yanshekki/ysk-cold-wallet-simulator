import { bech32, base58check as createBase58check } from '@scure/base';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import type { BackupKind, ChainPathId, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { catalogVersion } from '@cws/contracts';
import { concatBytes, encodeAscii } from '../bytes';
import { secp256k1 } from '@noble/curves/secp256k1';
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
import { bip143Sighash, p2wpkhScriptCode } from './psbt';

export const BITCOIN_APP_VERSION = catalogVersion('bitcoin', '2.4.2');

const b58c = createBase58check(sha256);

export type BtcCoin = 'bitcoin' | 'litecoin' | 'dogecoin' | 'bitcoin-test';

const COIN: Record<BtcCoin, { name: string; p2pkh: number; p2sh: number; hrp: string | null }> = {
  bitcoin: { name: 'Bitcoin', p2pkh: 0x00, p2sh: 0x05, hrp: 'bc' },
  'bitcoin-test': { name: 'Bitcoin Test', p2pkh: 0x6f, p2sh: 0xc4, hrp: 'tb' },
  litecoin: { name: 'Litecoin', p2pkh: 0x30, p2sh: 0x32, hrp: 'ltc' },
  dogecoin: { name: 'Dogecoin', p2pkh: 0x1e, p2sh: 0x16, hrp: null },
};

export type BtcSession = {
  version?: number;
  prevout?: Uint8Array;
  amount?: bigint;
  sequence?: number;
  outputs?: Uint8Array;
  locktime?: number;
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
  session.version = readU32le(apdu.data, 0);
  session.prevout = apdu.data.subarray(4, 40).slice();
  session.amount = readU64le(apdu.data, 40);
  session.sequence = readU32le(apdu.data, 48);
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
  const assembled = session?.prevout && session.outputs && session.amount != null && session.version != null;
  let hash: Uint8Array | null = null;
  if (assembled && session.prevout && session.outputs && session.amount != null && session.version != null) {
    session.locktime = rest.length >= 4 ? readU32le(rest, 0) : 0;
  }
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: `Sign ${COIN[coin].name} hash`,
    path,
    message: assembled
      ? `Sign ${COIN[coin].name} transaction\n${path}`
      : `Sign ${COIN[coin].name} 32-byte hash\n${path}`,
    rawPayload: assembled ? session.prevout! : rest,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const privateKey = derivePrivateKeyFromSeed(seed, path);
  if (assembled && session.prevout && session.outputs && session.amount != null && session.version != null) {
    const pub = publicKeyCompressed(privateKey);
    hash = bip143Sighash({
      version: session.version,
      prevout: session.prevout,
      amount: session.amount,
      sequence: session.sequence ?? 0xffffffff,
      scriptCode: p2wpkhScriptCode(hash160(pub)),
      outputs: session.outputs,
      locktime: session.locktime ?? 0,
    });
    session.prevout = undefined;
    session.outputs = undefined;
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
  const hash = sha256(sha256(rest));
  return encodeResponse(signSecp256k1Recoverable(privateKey, hash), SW_OK);
}
