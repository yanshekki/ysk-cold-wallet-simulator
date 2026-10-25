import { sha256 } from '@noble/hashes/sha2';
import { concatBytes } from '../bytes';

const MAGIC = Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff);

export type PsbtInput = {
  witnessUtxo?: { amount: bigint; script: Uint8Array };
  partialSigs: Array<{ pubkey: Uint8Array; signature: Uint8Array }>;
};

export type ParsedPsbt = {
  unsignedTx: Uint8Array;
  version: number;
  locktime: number;
  inputs: Array<{ prevout: Uint8Array; script: Uint8Array; sequence: number }>;
  outputs: Array<{ amount: bigint; script: Uint8Array }>;
  inputMaps: PsbtInput[];
};

export type LedgerPsbtFlow = {
  start: Uint8Array;
  outputs: Uint8Array;
  locktime: number;
};

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

export function u32le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let n = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
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

function compactSize(value: number): Uint8Array {
  if (value < 0xfd) {
    return Uint8Array.of(value);
  }
  if (value <= 0xffff) {
    return Uint8Array.of(0xfd, value & 0xff, (value >> 8) & 0xff);
  }
  return concatBytes(Uint8Array.of(0xfe), u32le(value));
}

function readCompactSize(bytes: Uint8Array, offset: number): { value: number; next: number } {
  const first = bytes[offset];
  if (first < 0xfd) {
    return { value: first, next: offset + 1 };
  }
  if (first === 0xfd) {
    return { value: bytes[offset + 1] | (bytes[offset + 2] << 8), next: offset + 3 };
  }
  if (first === 0xfe) {
    return { value: readU32le(bytes, offset + 1), next: offset + 5 };
  }
  throw new Error('compactSize too large');
}

function parseMaps(bytes: Uint8Array, offset: number, count: number): { maps: Array<Map<string, Uint8Array>>; next: number } {
  const maps: Array<Map<string, Uint8Array>> = [];
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    const map = new Map<string, Uint8Array>();
    while (cursor < bytes.length) {
      const keyLen = readCompactSize(bytes, cursor);
      cursor = keyLen.next;
      if (keyLen.value === 0) {
        break;
      }
      const key = bytes.subarray(cursor, cursor + keyLen.value);
      cursor += keyLen.value;
      const valueLen = readCompactSize(bytes, cursor);
      cursor = valueLen.next;
      const value = bytes.subarray(cursor, cursor + valueLen.value);
      cursor += valueLen.value;
      map.set(Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join(''), value.slice());
    }
    maps.push(map);
  }
  return { maps, next: cursor };
}

function parseTx(raw: Uint8Array): {
  version: number;
  locktime: number;
  inputs: Array<{ prevout: Uint8Array; script: Uint8Array; sequence: number }>;
  outputs: Array<{ amount: bigint; script: Uint8Array }>;
} {
  let offset = 0;
  const version = readU32le(raw, offset);
  offset += 4;
  if (raw[offset] === 0x00 && raw[offset + 1] === 0x01) {
    offset += 2;
  }
  const nIn = readCompactSize(raw, offset);
  offset = nIn.next;
  const inputs = [];
  for (let i = 0; i < nIn.value; i++) {
    const prevout = raw.subarray(offset, offset + 36);
    offset += 36;
    const scriptLen = readCompactSize(raw, offset);
    offset = scriptLen.next;
    const script = raw.subarray(offset, offset + scriptLen.value);
    offset += scriptLen.value;
    const sequence = readU32le(raw, offset);
    offset += 4;
    inputs.push({ prevout: prevout.slice(), script: script.slice(), sequence });
  }
  const nOut = readCompactSize(raw, offset);
  offset = nOut.next;
  const outputs = [];
  for (let i = 0; i < nOut.value; i++) {
    const amount = readU64le(raw, offset);
    offset += 8;
    const scriptLen = readCompactSize(raw, offset);
    offset = scriptLen.next;
    const script = raw.subarray(offset, offset + scriptLen.value);
    offset += scriptLen.value;
    outputs.push({ amount, script: script.slice() });
  }
  const locktime = readU32le(raw, offset);
  return { version, locktime, inputs, outputs };
}

export function parsePsbt(bytes: Uint8Array): ParsedPsbt {
  if (bytes.length < 5 || bytes[0] !== MAGIC[0] || bytes[4] !== MAGIC[4]) {
    throw new Error('not a PSBT');
  }
  const global = parseMaps(bytes, 5, 1);
  const unsigned = global.maps[0].get('00');
  if (!unsigned) {
    throw new Error('PSBT missing unsigned tx');
  }
  const tx = parseTx(unsigned);
  const inputMapsRaw = parseMaps(bytes, global.next, tx.inputs.length);
  const inputMaps = inputMapsRaw.maps.map((map) => {
    const witness = map.get('01');
    const partialSigs: PsbtInput['partialSigs'] = [];
    for (const [key, value] of map) {
      if (key.startsWith('02') && key.length > 2) {
        const pubkey = Uint8Array.from(key.slice(2).match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
        partialSigs.push({ pubkey, signature: value.slice() });
      }
    }
    return {
      witnessUtxo: witness
        ? { amount: readU64le(witness, 0), script: witness.subarray(8).slice() }
        : undefined,
      partialSigs,
    };
  });
  return {
    unsignedTx: unsigned.slice(),
    version: tx.version,
    locktime: tx.locktime,
    inputs: tx.inputs,
    outputs: tx.outputs,
    inputMaps,
  };
}

export function outputBodies(outputs: Array<{ amount: bigint; script: Uint8Array }>): Uint8Array {
  return concatBytes(
    ...outputs.map((output) => concatBytes(u64le(output.amount), compactSize(output.script.length), output.script)),
  );
}

export function serializeOutputs(outputs: Array<{ amount: bigint; script: Uint8Array }>): Uint8Array {
  return concatBytes(compactSize(outputs.length), outputBodies(outputs));
}

export function p2wpkhScriptCode(pubKeyHash: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(0x19, 0x76, 0xa9, 0x14), pubKeyHash, Uint8Array.of(0x88, 0xac));
}

export function bip143Sighash(input: {
  version: number;
  prevout: Uint8Array;
  amount: bigint;
  sequence: number;
  scriptCode: Uint8Array;
  outputs: Uint8Array;
  locktime: number;
  sighash?: number;
}): Uint8Array {
  const hashPrevouts = sha256d(input.prevout);
  const hashSequence = sha256d(u32le(input.sequence));
  const hashOutputs = sha256d(input.outputs);
  const preimage = concatBytes(
    u32le(input.version),
    hashPrevouts,
    hashSequence,
    input.prevout,
    input.scriptCode,
    u64le(input.amount),
    u32le(input.sequence),
    hashOutputs,
    u32le(input.locktime),
    u32le(input.sighash ?? 1),
  );
  return sha256d(preimage);
}

export function ledgerFlowFromPsbt(psbt: Uint8Array): LedgerPsbtFlow {
  const parsed = parsePsbt(psbt);
  const first = parsed.inputs[0];
  const amount = parsed.inputMaps[0]?.witnessUtxo?.amount ?? 0n;
  return {
    start: concatBytes(u32le(parsed.version), first.prevout, u64le(amount), u32le(first.sequence)),
    outputs: outputBodies(parsed.outputs),
    locktime: parsed.locktime,
  };
}

export function encodePsbt(parsed: ParsedPsbt): Uint8Array {
  const global = concatBytes(compactSize(1), Uint8Array.of(0x00), compactSize(parsed.unsignedTx.length), parsed.unsignedTx, compactSize(0));
  const inputParts: Uint8Array[] = [];
  for (let i = 0; i < parsed.inputs.length; i++) {
    const map = parsed.inputMaps[i];
    const entries: Uint8Array[] = [];
    if (map?.witnessUtxo) {
      const value = concatBytes(u64le(map.witnessUtxo.amount), map.witnessUtxo.script);
      entries.push(concatBytes(compactSize(1), Uint8Array.of(0x01), compactSize(value.length), value));
    }
    for (const sig of map?.partialSigs ?? []) {
      const key = concatBytes(Uint8Array.of(0x02), sig.pubkey);
      entries.push(concatBytes(compactSize(key.length), key, compactSize(sig.signature.length), sig.signature));
    }
    inputParts.push(concatBytes(...entries, compactSize(0)));
  }
  const outputParts = parsed.outputs.map(() => compactSize(0));
  return concatBytes(MAGIC, global, ...inputParts, ...outputParts);
}

export function attachPartialSig(psbt: Uint8Array, pubkey: Uint8Array, signature: Uint8Array): Uint8Array {
  const parsed = parsePsbt(psbt);
  if (!parsed.inputMaps[0]) {
    parsed.inputMaps[0] = { partialSigs: [] };
  }
  parsed.inputMaps[0].partialSigs = [{ pubkey, signature }];
  return encodePsbt(parsed);
}

export function buildP2wpkhPsbt(input: {
  prevTxId: Uint8Array;
  prevIndex: number;
  amount: bigint;
  scriptPubKey: Uint8Array;
  sequence?: number;
  version?: number;
  locktime?: number;
  outputs: Array<{ amount: bigint; script: Uint8Array }>;
}): Uint8Array {
  const prevout = concatBytes(input.prevTxId, u32le(input.prevIndex));
  const tx = concatBytes(
    u32le(input.version ?? 2),
    compactSize(1),
    prevout,
    compactSize(0),
    u32le(input.sequence ?? 0xffffffff),
    serializeOutputs(input.outputs),
    u32le(input.locktime ?? 0),
  );
  return encodePsbt({
    unsignedTx: tx,
    version: input.version ?? 2,
    locktime: input.locktime ?? 0,
    inputs: [{ prevout, script: new Uint8Array(), sequence: input.sequence ?? 0xffffffff }],
    outputs: input.outputs,
    inputMaps: [{ witnessUtxo: { amount: input.amount, script: input.scriptPubKey }, partialSigs: [] }],
  });
}
