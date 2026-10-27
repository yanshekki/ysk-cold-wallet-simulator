import { bech32, bech32m, base58check as createBase58check } from '@scure/base';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { HDKey } from '@scure/bip32';
import { encodeUr } from './bytewords';
import { asBytes, cborBytes, decodeCbor } from './cbor';
import {
  bitcoinP2tr,
  bitcoinP2wpkh,
  masterFingerprint,
  type EthAirgapQr,
} from './hdkey';
import { encodeFountainParts } from './ur';

const MAGIC = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]);
const GAP = 20;
const ZERO32 = new Uint8Array(32);
const b58c = createBase58check(sha256);
const SECP_N = secp256k1.CURVE.n;

export const SIGHASH_ALL = 0x01;
export const SIGHASH_NONE = 0x02;
export const SIGHASH_SINGLE = 0x03;
export const SIGHASH_ANYONECANPAY = 0x80;
export const SIGHASH_DEFAULT = 0x00;

const GAP_ACCOUNTS = [
  "m/84'/0'/0'",
  "m/84'/1'/0'",
  "m/49'/0'/0'",
  "m/49'/1'/0'",
  "m/44'/0'/0'",
  "m/44'/1'/0'",
  "m/86'/0'/0'",
  "m/86'/1'/0'",
];

export type PsbtMap = Map<string, Uint8Array>;

export type PsbtInput = {
  prevout: Uint8Array;
  script: Uint8Array;
  sequence: number;
};

export type PsbtOutput = {
  amount: bigint;
  script: Uint8Array;
};

export type ParsedPsbt = {
  version: number;
  locktime: number;
  inputs: PsbtInput[];
  outputs: PsbtOutput[];
  global: PsbtMap;
  inputMaps: PsbtMap[];
  outputMaps: PsbtMap[];
};

export type BtcPsbtOutput = {
  address: string;
  amountSats: bigint;
};

export type BtcPsbtPreview = {
  psbt: Uint8Array;
  path: string;
  address: string;
  fingerprint: string;
  outputs: BtcPsbtOutput[];
  feeSats?: bigint;
};

export type SignedPsbt = {
  psbt: Uint8Array;
  preview: BtcPsbtPreview;
};

type ScriptKind = 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr';

type SignableInput = {
  inputIndex: number;
  path: string;
  privateKey: Uint8Array;
  pub: Uint8Array;
  amount: bigint;
  scriptCode: Uint8Array;
  kind: ScriptKind;
  sighash: number;
  redeemScript?: Uint8Array;
  scriptPubKey: Uint8Array;
};

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  return sha256(concat(tagHash, tagHash, data));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function bytesToBig(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}

function bigToBytes32(value: bigint): Uint8Array {
  return fromHex(value.toString(16).padStart(64, '0'));
}

function readCompactSize(bytes: Uint8Array, offset: number): { value: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) {
    throw new Error('errors.qrBadUr');
  }
  if (first < 0xfd) {
    return { value: first, next: offset + 1 };
  }
  if (first === 0xfd) {
    return { value: bytes[offset + 1]! | (bytes[offset + 2]! << 8), next: offset + 3 };
  }
  if (first === 0xfe) {
    return {
      value:
        bytes[offset + 1]! |
        (bytes[offset + 2]! << 8) |
        (bytes[offset + 3]! << 16) |
        (bytes[offset + 4]! << 24),
      next: offset + 5,
    };
  }
  throw new Error('errors.qrBadUr');
}

function compactSize(value: number): Uint8Array {
  if (value < 0xfd) {
    return Uint8Array.of(value);
  }
  if (value <= 0xffff) {
    return Uint8Array.of(0xfd, value & 0xff, value >> 8);
  }
  return Uint8Array.of(0xfe, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function readU64le(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) + BigInt(bytes[offset + index]!);
  }
  return value;
}

function u32le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let next = value;
  for (let index = 0; index < 8; index += 1) {
    out[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return out;
}

function slice(bytes: Uint8Array, offset: number, length: number): { value: Uint8Array; next: number } {
  const end = offset + length;
  if (end > bytes.length) {
    throw new Error('errors.qrBadUr');
  }
  return { value: bytes.subarray(offset, end), next: end };
}

export function parseMap(bytes: Uint8Array): { map: PsbtMap; rest: Uint8Array } {
  const map: PsbtMap = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const keyLen = readCompactSize(bytes, offset);
    if (keyLen.value === 0) {
      return { map, rest: bytes.subarray(keyLen.next) };
    }
    const key = slice(bytes, keyLen.next, keyLen.value);
    const valueLen = readCompactSize(bytes, key.next);
    const value = slice(bytes, valueLen.next, valueLen.value);
    map.set(toHex(key.value), value.value);
    offset = value.next;
  }
  throw new Error('errors.qrBadUr');
}

function writeMap(map: PsbtMap): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [keyHex, value] of map) {
    const key = fromHex(keyHex);
    parts.push(compactSize(key.length), key, compactSize(value.length), value);
  }
  parts.push(Uint8Array.of(0x00));
  return concat(...parts);
}

function parseUnsignedTx(bytes: Uint8Array): {
  version: number;
  locktime: number;
  inputs: PsbtInput[];
  outputs: PsbtOutput[];
} {
  const version = readU32le(bytes, 0);
  const inputCount = readCompactSize(bytes, 4);
  let offset = inputCount.next;
  const inputs: PsbtInput[] = [];
  for (let index = 0; index < inputCount.value; index += 1) {
    const prevout = slice(bytes, offset, 36);
    const scriptLen = readCompactSize(bytes, prevout.next);
    const script = slice(bytes, scriptLen.next, scriptLen.value);
    const sequence = readU32le(bytes, script.next);
    inputs.push({ prevout: prevout.value, script: script.value, sequence });
    offset = script.next + 4;
  }
  const outputCount = readCompactSize(bytes, offset);
  offset = outputCount.next;
  const outputs: PsbtOutput[] = [];
  for (let index = 0; index < outputCount.value; index += 1) {
    const amount = readU64le(bytes, offset);
    const scriptLen = readCompactSize(bytes, offset + 8);
    const script = slice(bytes, scriptLen.next, scriptLen.value);
    outputs.push({ amount, script: script.value });
    offset = script.next;
  }
  return { version, inputs, outputs, locktime: readU32le(bytes, offset) };
}

function skipWitness(bytes: Uint8Array, offset: number, inputCount: number): number {
  let cursor = offset;
  for (let index = 0; index < inputCount; index += 1) {
    const stack = readCompactSize(bytes, cursor);
    cursor = stack.next;
    for (let item = 0; item < stack.value; item += 1) {
      const size = readCompactSize(bytes, cursor);
      cursor = size.next + size.value;
    }
  }
  return cursor;
}

function parseBitcoinTx(bytes: Uint8Array): { outputs: PsbtOutput[] } {
  let offset = 4;
  let hasWitness = false;
  if (bytes[offset] === 0x00 && bytes[offset + 1] === 0x01) {
    hasWitness = true;
    offset += 2;
  }
  const inputCount = readCompactSize(bytes, offset);
  offset = inputCount.next;
  for (let index = 0; index < inputCount.value; index += 1) {
    offset += 36;
    const scriptLen = readCompactSize(bytes, offset);
    offset = scriptLen.next + scriptLen.value + 4;
  }
  const outputCount = readCompactSize(bytes, offset);
  offset = outputCount.next;
  const outputs: PsbtOutput[] = [];
  for (let index = 0; index < outputCount.value; index += 1) {
    const amount = readU64le(bytes, offset);
    const scriptLen = readCompactSize(bytes, offset + 8);
    const script = slice(bytes, scriptLen.next, scriptLen.value);
    outputs.push({ amount, script: script.value });
    offset = script.next;
  }
  if (hasWitness) {
    offset = skipWitness(bytes, offset, inputCount.value);
  }
  return { outputs };
}

export function parsePsbt(bytes: Uint8Array): ParsedPsbt {
  if (bytes.length < 5 || !bytesEqual(bytes.subarray(0, 5), MAGIC)) {
    throw new Error('errors.qrBadUr');
  }
  const globalParsed = parseMap(bytes.subarray(5));
  const unsigned = globalParsed.map.get('00');
  if (!unsigned) {
    throw new Error('errors.qrBadUr');
  }
  const tx = parseUnsignedTx(unsigned);
  let rest = globalParsed.rest;
  const inputMaps: PsbtMap[] = [];
  for (let index = 0; index < tx.inputs.length; index += 1) {
    const parsed = parseMap(rest);
    inputMaps.push(parsed.map);
    rest = parsed.rest;
  }
  const outputMaps: PsbtMap[] = [];
  for (let index = 0; index < tx.outputs.length; index += 1) {
    if (!rest.length) {
      outputMaps.push(new Map());
      continue;
    }
    const parsed = parseMap(rest);
    outputMaps.push(parsed.map);
    rest = parsed.rest;
  }
  return { ...tx, global: globalParsed.map, inputMaps, outputMaps };
}

export function encodePsbt(parsed: ParsedPsbt): Uint8Array {
  return concat(MAGIC, writeMap(parsed.global), ...parsed.inputMaps.map(writeMap), ...parsed.outputMaps.map(writeMap));
}

export function p2wpkhScriptCode(pubkeyHash: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x19, 0x76, 0xa9, 0x14), pubkeyHash, Uint8Array.of(0x88, 0xac));
}

function p2pkhScriptCode(pubkeyHash: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x19, 0x76, 0xa9, 0x14), pubkeyHash, Uint8Array.of(0x88, 0xac));
}

function serializeOutput(output: PsbtOutput): Uint8Array {
  return concat(u64le(output.amount), compactSize(output.script.length), output.script);
}

function serializeScript(script: Uint8Array): Uint8Array {
  return concat(compactSize(script.length), script);
}

export function bip143Sighash(
  parsed: ParsedPsbt,
  inputIndex: number,
  scriptCode: Uint8Array,
  amount: bigint,
  sighash = SIGHASH_ALL,
): Uint8Array {
  const input = parsed.inputs[inputIndex];
  if (!input) {
    throw new Error('errors.qrBadUr');
  }
  const base = sighash & 0x1f;
  const anyone = (sighash & SIGHASH_ANYONECANPAY) !== 0;
  const hashPrevouts = anyone ? ZERO32 : sha256d(concat(...parsed.inputs.map((item) => item.prevout)));
  const hashSequence =
    anyone || base === SIGHASH_NONE || base === SIGHASH_SINGLE
      ? ZERO32
      : sha256d(concat(...parsed.inputs.map((item) => u32le(item.sequence))));
  let hashOutputs: Uint8Array = ZERO32;
  if (base === SIGHASH_ALL || base === 0) {
    hashOutputs = sha256d(concat(...parsed.outputs.map(serializeOutput)));
  } else if (base === SIGHASH_SINGLE && inputIndex < parsed.outputs.length) {
    hashOutputs = sha256d(serializeOutput(parsed.outputs[inputIndex]!));
  }
  return sha256d(
    concat(
      u32le(parsed.version),
      hashPrevouts,
      hashSequence,
      input.prevout,
      scriptCode,
      u64le(amount),
      u32le(input.sequence),
      hashOutputs,
      u32le(parsed.locktime),
      u32le(sighash),
    ),
  );
}

export function legacySighash(
  parsed: ParsedPsbt,
  inputIndex: number,
  scriptCode: Uint8Array,
  sighash = SIGHASH_ALL,
): Uint8Array {
  const base = sighash & 0x1f;
  const anyone = (sighash & SIGHASH_ANYONECANPAY) !== 0;
  if (base === SIGHASH_SINGLE && inputIndex >= parsed.outputs.length) {
    throw new Error('errors.qrUnsupported');
  }
  const inputs = anyone ? [parsed.inputs[inputIndex]!] : parsed.inputs;
  const parts: Uint8Array[] = [u32le(parsed.version), compactSize(inputs.length)];
  for (let index = 0; index < inputs.length; index += 1) {
    const sourceIndex = anyone ? inputIndex : index;
    const item = parsed.inputs[sourceIndex]!;
    const signing = sourceIndex === inputIndex;
    const sequence =
      !signing && (base === SIGHASH_NONE || base === SIGHASH_SINGLE) ? 0 : item.sequence;
    const script = signing ? scriptCode.subarray(1) : new Uint8Array();
    parts.push(item.prevout, compactSize(script.length), script, u32le(sequence));
  }
  if (base === SIGHASH_NONE) {
    parts.push(compactSize(0));
  } else if (base === SIGHASH_SINGLE) {
    parts.push(compactSize(inputIndex + 1));
    for (let index = 0; index < inputIndex; index += 1) {
      parts.push(u64le(0xffffffffffffffffn), compactSize(0));
    }
    parts.push(serializeOutput(parsed.outputs[inputIndex]!));
  } else {
    parts.push(compactSize(parsed.outputs.length), ...parsed.outputs.map(serializeOutput));
  }
  parts.push(u32le(parsed.locktime), u32le(sighash));
  return sha256d(concat(...parts));
}

export function bip341Sighash(
  parsed: ParsedPsbt,
  inputIndex: number,
  amounts: bigint[],
  scriptPubKeys: Uint8Array[],
  sighash = SIGHASH_DEFAULT,
): Uint8Array {
  const input = parsed.inputs[inputIndex];
  if (!input) {
    throw new Error('errors.qrBadUr');
  }
  const hashType = sighash === SIGHASH_DEFAULT ? SIGHASH_ALL : sighash;
  const base = hashType & 0x1f;
  const anyone = (hashType & SIGHASH_ANYONECANPAY) !== 0;
  const parts: Uint8Array[] = [Uint8Array.of(0x00), Uint8Array.of(sighash), u32le(parsed.version), u32le(parsed.locktime)];
  if (!anyone) {
    parts.push(
      sha256(concat(...parsed.inputs.map((item) => item.prevout))),
      sha256(concat(...amounts.map(u64le))),
      sha256(concat(...scriptPubKeys.map(serializeScript))),
      sha256(concat(...parsed.inputs.map((item) => u32le(item.sequence)))),
    );
  }
  if (base !== SIGHASH_NONE && base !== SIGHASH_SINGLE) {
    parts.push(sha256(concat(...parsed.outputs.map(serializeOutput))));
  }
  parts.push(Uint8Array.of(0x00));
  if (anyone) {
    parts.push(
      input.prevout,
      u64le(amounts[inputIndex]!),
      serializeScript(scriptPubKeys[inputIndex]!),
      u32le(input.sequence),
    );
  } else {
    parts.push(u32le(inputIndex));
  }
  if (base === SIGHASH_SINGLE) {
    if (inputIndex >= parsed.outputs.length) {
      throw new Error('errors.qrUnsupported');
    }
    parts.push(sha256(serializeOutput(parsed.outputs[inputIndex]!)));
  }
  return taggedHash('TapSighash', concat(...parts));
}

function trimDerInt(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start += 1;
  }
  const trimmed = bytes.subarray(start);
  if (trimmed[0]! & 0x80) {
    return concat(Uint8Array.of(0x00), trimmed);
  }
  return trimmed;
}

export function encodeDerSignature(compactRs: Uint8Array): Uint8Array {
  const r = trimDerInt(compactRs.subarray(0, 32));
  const s = trimDerInt(compactRs.subarray(32, 64));
  const body = concat(Uint8Array.of(0x02, r.length), r, Uint8Array.of(0x02, s.length), s);
  return concat(Uint8Array.of(0x30, body.length), body);
}

export function attachPartialSig(psbt: Uint8Array, inputIndex: number, pubkey: Uint8Array, signature: Uint8Array): Uint8Array {
  const parsed = parsePsbt(psbt);
  const map = parsed.inputMaps[inputIndex];
  if (!map) {
    throw new Error('errors.qrBadUr');
  }
  map.set(`02${toHex(pubkey)}`, signature);
  return encodePsbt(parsed);
}

function parseWitnessUtxo(value: Uint8Array): { amount: bigint; script: Uint8Array } {
  if (value.length < 9) {
    throw new Error('errors.qrBadUr');
  }
  const amount = readU64le(value, 0);
  const scriptLen = readCompactSize(value, 8);
  const script = slice(value, scriptLen.next, scriptLen.value);
  return { amount, script: script.value };
}

function pathFromDerivation(value: Uint8Array, offset = 0): { fingerprint: number; path: string } {
  if (value.length < offset + 4 || (value.length - offset - 4) % 4 !== 0) {
    throw new Error('errors.qrBadUr');
  }
  const fingerprint = readU32be(value, offset);
  const parts = ['m'];
  for (let cursor = offset + 4; cursor < value.length; cursor += 4) {
    const index = readU32le(value, cursor);
    if (index >= 0x80000000) {
      parts.push(`${index - 0x80000000}'`);
    } else {
      parts.push(String(index));
    }
  }
  return { fingerprint, path: parts.join('/') };
}

function networkFromPath(path: string): 'main' | 'test' {
  return /\/(84|49|44|86)'\/1'/.test(path) ? 'test' : 'main';
}

function hrpFor(network: 'main' | 'test'): string {
  return network === 'test' ? 'tb' : 'bc';
}

export function scriptToAddress(script: Uint8Array, network: 'main' | 'test' = 'main'): string {
  const hrp = hrpFor(network);
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
    return bech32.encode(hrp, [0, ...bech32.toWords(script.subarray(2))]);
  }
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) {
    return bech32m.encode(hrp, [1, ...bech32m.toWords(script.subarray(2))]);
  }
  if (script.length === 25 && script[0] === 0x76 && script[1] === 0xa9 && script[2] === 0x14 && script[23] === 0x88 && script[24] === 0xac) {
    return b58c.encode(concat(Uint8Array.of(network === 'test' ? 0x6f : 0x00), script.subarray(3, 23)));
  }
  if (script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87) {
    return b58c.encode(concat(Uint8Array.of(network === 'test' ? 0xc4 : 0x05), script.subarray(2, 22)));
  }
  return toHex(script);
}

function isP2wpkh(script: Uint8Array): boolean {
  return script.length === 22 && script[0] === 0x00 && script[1] === 0x14;
}

function isP2pkh(script: Uint8Array): boolean {
  return script.length === 25 && script[0] === 0x76 && script[1] === 0xa9 && script[2] === 0x14 && script[23] === 0x88 && script[24] === 0xac;
}

function isP2sh(script: Uint8Array): boolean {
  return script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87;
}

function isP2tr(script: Uint8Array): boolean {
  return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
}

function p2wpkhScript(pub: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x00, 0x14), hash160(pub));
}

function p2pkhScript(pub: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x76, 0xa9, 0x14), hash160(pub), Uint8Array.of(0x88, 0xac));
}

function p2shP2wpkhRedeem(pub: Uint8Array): Uint8Array {
  return p2wpkhScript(pub);
}

function p2shP2wpkhScript(pub: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0xa9, 0x14), hash160(p2shP2wpkhRedeem(pub)), Uint8Array.of(0x87));
}

function evenPriv(priv: Uint8Array): { priv: Uint8Array; xOnly: Uint8Array } {
  const pub = secp256k1.getPublicKey(priv, true);
  const xOnly = pub.subarray(1);
  if (pub[0] === 0x02) {
    return { priv, xOnly };
  }
  return { priv: bigToBytes32((SECP_N - bytesToBig(priv)) % SECP_N), xOnly };
}

export function taprootOutputKey(priv: Uint8Array): { tweakedPriv: Uint8Array; outputXOnly: Uint8Array; internalXOnly: Uint8Array } {
  const even = evenPriv(priv);
  const t = bytesToBig(taggedHash('TapTweak', even.xOnly));
  if (t >= SECP_N) {
    throw new Error('errors.qrUnsupported');
  }
  const tweaked = (bytesToBig(even.priv) + t) % SECP_N;
  if (tweaked === 0n) {
    throw new Error('errors.qrUnsupported');
  }
  const tweakedPriv = bigToBytes32(tweaked);
  return { tweakedPriv, outputXOnly: schnorr.getPublicKey(tweakedPriv), internalXOnly: even.xOnly };
}

function sighashFromMap(inputMap: PsbtMap, taproot: boolean): number {
  const raw = inputMap.get('03');
  if (!raw || raw.length === 0) {
    return taproot ? SIGHASH_DEFAULT : SIGHASH_ALL;
  }
  const value = raw[0]!;
  const base = value & 0x1f;
  if (value !== SIGHASH_DEFAULT && base !== SIGHASH_ALL && base !== SIGHASH_NONE && base !== SIGHASH_SINGLE) {
    throw new Error('errors.qrUnsupported');
  }
  return value;
}

function scriptFromInput(
  parsed: ParsedPsbt,
  inputIndex: number,
  inputMap: PsbtMap,
): { amount: bigint; script: Uint8Array } | null {
  const witnessRaw = inputMap.get('01');
  if (witnessRaw) {
    return parseWitnessUtxo(witnessRaw);
  }
  const prevTx = inputMap.get('00');
  if (!prevTx) {
    return null;
  }
  const vout = readU32le(parsed.inputs[inputIndex]!.prevout, 32);
  const prev = parseBitcoinTx(prevTx);
  const output = prev.outputs[vout];
  if (!output) {
    throw new Error('errors.qrBadUr');
  }
  return { amount: output.amount, script: output.script };
}

function addressFor(kind: ScriptKind, pub: Uint8Array, priv: Uint8Array, network: 'main' | 'test'): string {
  const hrp = hrpFor(network);
  if (kind === 'p2wpkh') {
    return bitcoinP2wpkh(pub, hrp);
  }
  if (kind === 'p2tr') {
    return bitcoinP2tr(taprootOutputKey(priv).outputXOnly, hrp);
  }
  if (kind === 'p2sh-p2wpkh') {
    return b58c.encode(concat(Uint8Array.of(network === 'test' ? 0xc4 : 0x05), hash160(p2shP2wpkhRedeem(pub))));
  }
  return b58c.encode(concat(Uint8Array.of(network === 'test' ? 0x6f : 0x00), hash160(pub)));
}

function matchDerived(
  master: HDKey,
  path: string,
  expectedPub: Uint8Array | null,
): { path: string; privateKey: Uint8Array; pub: Uint8Array } {
  const node = master.derive(path);
  if (!node.privateKey || !node.publicKey) {
    throw new Error('errors.qrAddress');
  }
  if (expectedPub && !bytesEqual(node.publicKey, expectedPub) && !bytesEqual(node.publicKey.subarray(1), expectedPub)) {
    throw new Error('errors.qrAddress');
  }
  return { path, privateKey: node.privateKey, pub: node.publicKey };
}

function matchByScript(
  master: HDKey,
  script: Uint8Array,
): { path: string; privateKey: Uint8Array; pub: Uint8Array; kind: ScriptKind } | null {
  for (const account of GAP_ACCOUNTS) {
    for (let change = 0; change <= 1; change += 1) {
      for (let index = 0; index < GAP; index += 1) {
        const path = `${account}/${change}/${index}`;
        const node = master.derive(path);
        if (!node.privateKey || !node.publicKey) {
          continue;
        }
        if (isP2wpkh(script) && bytesEqual(hash160(node.publicKey), script.subarray(2))) {
          return { path, privateKey: node.privateKey, pub: node.publicKey, kind: 'p2wpkh' };
        }
        if (isP2pkh(script) && bytesEqual(hash160(node.publicKey), script.subarray(3, 23))) {
          return { path, privateKey: node.privateKey, pub: node.publicKey, kind: 'p2pkh' };
        }
        if (isP2sh(script) && bytesEqual(hash160(p2shP2wpkhRedeem(node.publicKey)), script.subarray(2, 22))) {
          return { path, privateKey: node.privateKey, pub: node.publicKey, kind: 'p2sh-p2wpkh' };
        }
        if (isP2tr(script) && bytesEqual(taprootOutputKey(node.privateKey).outputXOnly, script.subarray(2))) {
          return { path, privateKey: node.privateKey, pub: node.publicKey, kind: 'p2tr' };
        }
      }
    }
  }
  return null;
}

function kindFromScript(
  script: Uint8Array,
  redeem: Uint8Array | undefined,
  priv: Uint8Array,
  pub: Uint8Array,
): ScriptKind {
  if (isP2tr(script)) {
    if (!bytesEqual(taprootOutputKey(priv).outputXOnly, script.subarray(2))) {
      throw new Error('errors.qrAddress');
    }
    return 'p2tr';
  }
  if (isP2wpkh(script)) {
    return 'p2wpkh';
  }
  if (isP2pkh(script)) {
    return 'p2pkh';
  }
  if (isP2sh(script)) {
    const expected = redeem ?? p2shP2wpkhRedeem(pub);
    if (!isP2wpkh(expected) || !bytesEqual(hash160(expected), script.subarray(2, 22))) {
      throw new Error('errors.qrUnsupported');
    }
    return 'p2sh-p2wpkh';
  }
  throw new Error('errors.qrUnsupported');
}

function matchInput(
  master: HDKey,
  masterFp: number,
  parsed: ParsedPsbt,
  inputIndex: number,
): Omit<SignableInput, 'inputIndex'> | null {
  const inputMap = parsed.inputMaps[inputIndex];
  if (!inputMap) {
    return null;
  }
  if (inputMap.has('18') || [...inputMap.keys()].some((key) => key.startsWith('15') || key.startsWith('14'))) {
    throw new Error('errors.qrUnsupported');
  }
  const derivations = [...inputMap.entries()].filter(([key]) => key.startsWith('06') && key.length === 68);
  const tapDerivations = [...inputMap.entries()].filter(([key]) => key.startsWith('16') && key.length === 66);
  if (derivations.length > 1 || tapDerivations.length > 1) {
    throw new Error('errors.qrUnsupported');
  }
  const utxo = scriptFromInput(parsed, inputIndex, inputMap);
  const taproot = Boolean(utxo && isP2tr(utxo.script)) || tapDerivations.length > 0;
  const sighash = sighashFromMap(inputMap, taproot);
  if (derivations.length === 1 || tapDerivations.length === 1) {
    const [key, value] = (tapDerivations[0] ?? derivations[0])!;
    const pubOrXonly = fromHex(key.slice(2));
    if (tapDerivations.length && value[0] !== 0) {
      throw new Error('errors.qrUnsupported');
    }
    const derived = pathFromDerivation(value, tapDerivations.length ? 1 : 0);
    if (derived.fingerprint !== masterFp) {
      throw new Error('errors.qrXfp');
    }
    const matched = matchDerived(master, derived.path, tapDerivations.length ? pubOrXonly : pubOrXonly);
    if (!utxo) {
      throw new Error('errors.qrUnsupported');
    }
    const kind = kindFromScript(utxo.script, inputMap.get('04'), matched.privateKey, matched.pub);
    return {
      ...matched,
      amount: utxo.amount,
      scriptCode: kind === 'p2pkh' ? p2pkhScriptCode(hash160(matched.pub)) : p2wpkhScriptCode(hash160(matched.pub)),
      kind,
      sighash,
      redeemScript: kind === 'p2sh-p2wpkh' ? p2shP2wpkhRedeem(matched.pub) : undefined,
      scriptPubKey: utxo.script,
    };
  }
  if (!utxo) {
    return null;
  }
  const scanned = matchByScript(master, utxo.script);
  if (!scanned) {
    return null;
  }
  return {
    ...scanned,
    amount: utxo.amount,
    scriptCode: scanned.kind === 'p2pkh' ? p2pkhScriptCode(hash160(scanned.pub)) : p2wpkhScriptCode(hash160(scanned.pub)),
    sighash,
    redeemScript: scanned.kind === 'p2sh-p2wpkh' ? p2shP2wpkhRedeem(scanned.pub) : undefined,
    scriptPubKey: utxo.script,
  };
}

function inputAmount(parsed: ParsedPsbt, inputIndex: number): bigint | null {
  const utxo = scriptFromInput(parsed, inputIndex, parsed.inputMaps[inputIndex]!);
  return utxo?.amount ?? null;
}

function matchAndPreview(seed: Uint8Array, psbt: Uint8Array): { preview: BtcPsbtPreview; parsed: ParsedPsbt; signables: SignableInput[] } {
  const parsed = parsePsbt(psbt);
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('errors.qrBadUr');
  }
  const masterFp = masterFingerprint(master.publicKey);
  const signables: SignableInput[] = [];
  for (let index = 0; index < parsed.inputMaps.length; index += 1) {
    const matched = matchInput(master, masterFp, parsed, index);
    if (matched) {
      signables.push({ inputIndex: index, ...matched });
    }
  }
  if (!signables.length) {
    throw new Error('errors.qrPsbtMismatch');
  }
  const amounts = parsed.inputMaps.map((_, index) => inputAmount(parsed, index));
  const haveAmounts = amounts.every((amount) => amount != null);
  const inputTotal = haveAmounts ? amounts.reduce((sum, amount) => sum + amount!, 0n) : 0n;
  const outputTotal = parsed.outputs.reduce((sum, output) => sum + output.amount, 0n);
  const first = signables[0]!;
  const network = networkFromPath(first.path);
  return {
    parsed,
    signables,
    preview: {
      psbt,
      path: first.path,
      address: addressFor(first.kind, first.pub, first.privateKey, network),
      fingerprint: masterFp.toString(16).padStart(8, '0'),
      outputs: parsed.outputs.map((output) => ({
        address: scriptToAddress(output.script, network),
        amountSats: output.amount,
      })),
      feeSats: haveAmounts && inputTotal >= outputTotal ? inputTotal - outputTotal : undefined,
    },
  };
}

export function decodeCryptoPsbt(cbor: Uint8Array): Uint8Array {
  try {
    return asBytes(decodeCbor(cbor));
  } catch {
    throw new Error('errors.qrBadUr');
  }
}

export function encodeCryptoPsbtCbor(psbt: Uint8Array): Uint8Array {
  return cborBytes(psbt);
}

export function encodeCryptoPsbtUr(psbt: Uint8Array, maxFragment = 200): { ur: string; parts: string[] } {
  const cbor = encodeCryptoPsbtCbor(psbt);
  const ur = encodeUr('crypto-psbt', cbor);
  const parts = encodeFountainParts('crypto-psbt', cbor, maxFragment);
  return { ur, parts: parts.length > 1 ? parts : [ur] };
}

export function previewCryptoPsbt(seed: Uint8Array, cbor: Uint8Array): BtcPsbtPreview {
  return matchAndPreview(seed, decodeCryptoPsbt(cbor)).preview;
}

export function previewPsbt(seed: Uint8Array, psbt: Uint8Array): BtcPsbtPreview {
  return matchAndPreview(seed, psbt).preview;
}

function signInput(parsed: ParsedPsbt, item: SignableInput, amounts: bigint[], scripts: Uint8Array[]): void {
  const map = parsed.inputMaps[item.inputIndex]!;
  if (item.kind === 'p2tr') {
    const tweaked = taprootOutputKey(item.privateKey);
    const hash = bip341Sighash(parsed, item.inputIndex, amounts, scripts, item.sighash);
    const sig = schnorr.sign(hash, tweaked.tweakedPriv);
    const encoded = item.sighash === SIGHASH_DEFAULT ? sig : concat(sig, Uint8Array.of(item.sighash));
    map.set('13', encoded);
    if (!map.get('17')) {
      map.set('17', tweaked.internalXOnly);
    }
    return;
  }
  const hash =
    item.kind === 'p2pkh'
      ? legacySighash(parsed, item.inputIndex, item.scriptCode, item.sighash || SIGHASH_ALL)
      : bip143Sighash(parsed, item.inputIndex, item.scriptCode, item.amount, item.sighash || SIGHASH_ALL);
  const compact = secp256k1.sign(hash, item.privateKey).toCompactRawBytes();
  const signature = concat(encodeDerSignature(compact), Uint8Array.of(item.sighash || SIGHASH_ALL));
  map.set(`02${toHex(item.pub)}`, signature);
  if (item.redeemScript && !map.get('04')) {
    map.set('04', item.redeemScript);
  }
}

export function signPsbtBytes(seed: Uint8Array, psbt: Uint8Array): SignedPsbt {
  const { preview, parsed, signables } = matchAndPreview(seed, psbt);
  const amounts = parsed.inputMaps.map((_, index) => inputAmount(parsed, index) ?? 0n);
  const scripts = parsed.inputMaps.map((map, index) => scriptFromInput(parsed, index, map)?.script ?? new Uint8Array());
  for (const item of signables) {
    signInput(parsed, item, amounts, scripts);
  }
  return { psbt: encodePsbt(parsed), preview };
}

export function signCryptoPsbt(seed: Uint8Array, cbor: Uint8Array): EthAirgapQr {
  const signed = signPsbtBytes(seed, decodeCryptoPsbt(cbor));
  const encoded = encodeCryptoPsbtUr(signed.psbt);
  return {
    ur: encoded.ur,
    parts: encoded.parts,
    path: signed.preview.path,
    address: signed.preview.address,
    fingerprint: signed.preview.fingerprint,
    name: 'CWS',
    urKind: 'crypto-psbt',
  };
}

export function encodeDerivation(fingerprint: number, indexes: number[]): Uint8Array {
  const out = new Uint8Array(4 + indexes.length * 4);
  out[0] = (fingerprint >>> 24) & 0xff;
  out[1] = (fingerprint >>> 16) & 0xff;
  out[2] = (fingerprint >>> 8) & 0xff;
  out[3] = fingerprint & 0xff;
  for (let index = 0; index < indexes.length; index += 1) {
    out.set(u32le(indexes[index]!), 4 + index * 4);
  }
  return out;
}

export function encodeWitnessUtxo(amount: bigint, script: Uint8Array): Uint8Array {
  return concat(u64le(amount), compactSize(script.length), script);
}

function encodeUnsignedTx(inputs: Array<{ prevout: Uint8Array; sequence: number }>, outputs: PsbtOutput[], version = 2, locktime = 0): Uint8Array {
  return concat(
    u32le(version),
    compactSize(inputs.length),
    ...inputs.flatMap((input) => [input.prevout, compactSize(0), u32le(input.sequence)]),
    compactSize(outputs.length),
    ...outputs.map(serializeOutput),
    u32le(locktime),
  );
}

export function buildP2wpkhPsbt(input: {
  prevout?: Uint8Array;
  amount: bigint;
  pubkey: Uint8Array;
  fingerprint: number;
  pathIndexes: number[];
  outputScript: Uint8Array;
  outputAmount: bigint;
  locktime?: number;
  extraInputs?: Array<{
    prevout: Uint8Array;
    amount: bigint;
    pubkey: Uint8Array;
    pathIndexes: number[];
  }>;
  sighash?: number;
}): Uint8Array {
  const prevout = input.prevout ?? concat(new Uint8Array(32).fill(1), u32le(0));
  const script = p2wpkhScript(input.pubkey);
  const extras = input.extraInputs ?? [];
  const txInputs = [{ prevout, sequence: 0xffffffff }, ...extras.map((item) => ({ prevout: item.prevout, sequence: 0xffffffff }))];
  const outputs = [{ amount: input.outputAmount, script: input.outputScript }];
  const unsigned = encodeUnsignedTx(txInputs, outputs, 2, input.locktime ?? 0);
  const global: PsbtMap = new Map([['00', unsigned]]);
  const maps: PsbtMap[] = [
    new Map([
      ['01', encodeWitnessUtxo(input.amount, script)],
      [`06${toHex(input.pubkey)}`, encodeDerivation(input.fingerprint, input.pathIndexes)],
      ...(input.sighash != null ? ([['03', Uint8Array.of(input.sighash)]] as Array<[string, Uint8Array]>) : []),
    ]),
  ];
  for (const extra of extras) {
    maps.push(
      new Map([
        ['01', encodeWitnessUtxo(extra.amount, p2wpkhScript(extra.pubkey))],
        [`06${toHex(extra.pubkey)}`, encodeDerivation(input.fingerprint, extra.pathIndexes)],
      ]),
    );
  }
  return encodePsbt({
    version: 2,
    locktime: input.locktime ?? 0,
    inputs: txInputs.map((item) => ({ prevout: item.prevout, script: new Uint8Array(), sequence: item.sequence })),
    outputs,
    global,
    inputMaps: maps,
    outputMaps: outputs.map(() => new Map()),
  });
}

export function buildP2shP2wpkhPsbt(input: {
  amount: bigint;
  pubkey: Uint8Array;
  fingerprint: number;
  pathIndexes: number[];
  outputScript: Uint8Array;
  outputAmount: bigint;
}): Uint8Array {
  const prevout = concat(new Uint8Array(32).fill(2), u32le(0));
  const script = p2shP2wpkhScript(input.pubkey);
  const redeem = p2shP2wpkhRedeem(input.pubkey);
  const unsigned = encodeUnsignedTx([{ prevout, sequence: 0xffffffff }], [{ amount: input.outputAmount, script: input.outputScript }]);
  return encodePsbt({
    version: 2,
    locktime: 0,
    inputs: [{ prevout, script: new Uint8Array(), sequence: 0xffffffff }],
    outputs: [{ amount: input.outputAmount, script: input.outputScript }],
    global: new Map([['00', unsigned]]),
    inputMaps: [
      new Map([
        ['01', encodeWitnessUtxo(input.amount, script)],
        ['04', redeem],
        [`06${toHex(input.pubkey)}`, encodeDerivation(input.fingerprint, input.pathIndexes)],
      ]),
    ],
    outputMaps: [new Map()],
  });
}

export function buildP2pkhPsbt(input: {
  amount: bigint;
  pubkey: Uint8Array;
  fingerprint: number;
  pathIndexes: number[];
  outputScript: Uint8Array;
  outputAmount: bigint;
}): Uint8Array {
  const prevout = concat(new Uint8Array(32).fill(3), u32le(0));
  const script = p2pkhScript(input.pubkey);
  const prevTx = concat(
    u32le(1),
    compactSize(1),
    concat(new Uint8Array(32).fill(9), u32le(0)),
    compactSize(0),
    u32le(0xffffffff),
    compactSize(1),
    serializeOutput({ amount: input.amount, script }),
    u32le(0),
  );
  const unsigned = encodeUnsignedTx([{ prevout, sequence: 0xffffffff }], [{ amount: input.outputAmount, script: input.outputScript }]);
  return encodePsbt({
    version: 2,
    locktime: 0,
    inputs: [{ prevout, script: new Uint8Array(), sequence: 0xffffffff }],
    outputs: [{ amount: input.outputAmount, script: input.outputScript }],
    global: new Map([['00', unsigned]]),
    inputMaps: [
      new Map([
        ['00', prevTx],
        [`06${toHex(input.pubkey)}`, encodeDerivation(input.fingerprint, input.pathIndexes)],
      ]),
    ],
    outputMaps: [new Map()],
  });
}

export function buildP2trPsbt(input: {
  amount: bigint;
  privateKey: Uint8Array;
  pubkey: Uint8Array;
  fingerprint: number;
  pathIndexes: number[];
  outputScript: Uint8Array;
  outputAmount: bigint;
}): Uint8Array {
  const prevout = concat(new Uint8Array(32).fill(4), u32le(0));
  const outputXOnly = taprootOutputKey(input.privateKey).outputXOnly;
  const script = concat(Uint8Array.of(0x51, 0x20), outputXOnly);
  const unsigned = encodeUnsignedTx([{ prevout, sequence: 0xffffffff }], [{ amount: input.outputAmount, script: input.outputScript }]);
  const xOnly = evenPriv(input.privateKey).xOnly;
  return encodePsbt({
    version: 2,
    locktime: 0,
    inputs: [{ prevout, script: new Uint8Array(), sequence: 0xffffffff }],
    outputs: [{ amount: input.outputAmount, script: input.outputScript }],
    global: new Map([['00', unsigned]]),
    inputMaps: [
      new Map([
        ['01', encodeWitnessUtxo(input.amount, script)],
        ['17', xOnly],
        [`16${toHex(xOnly)}`, concat(Uint8Array.of(0x00), encodeDerivation(input.fingerprint, input.pathIndexes))],
      ]),
    ],
    outputMaps: [new Map()],
  });
}
