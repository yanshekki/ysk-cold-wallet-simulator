import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { mnemonicToEntropy, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import type { ConfirmationPort } from '@cws/contracts';
import { LEDGER_MODELS } from '@cws/contracts';
import { SW_OK } from '../apdu';
import { concatBytes } from '../bytes';
import { deriveEd25519PrivateKeyFromSeed, ed25519PublicKey, signEd25519 } from '../crypto';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import {
  SW_TON_BLIND_SIGNING_DISABLED,
  SW_TON_SIGN_DATA_PARSING_FAIL,
  SW_TON_TX_PARSING_FAIL,
} from './ton';
import {
  DEFAULT_SUBWALLET_ID,
  deserializeTonSignData,
  deserializeTonTx,
  hashTonTx,
  HINT_COMMENT,
  PLAINTEXT_REQUEST,
  pubkeyToHash,
  tonConnectProofHash,
} from './tonCell';

const FOUNDATION = 'test test test test test test test test test test test junk';
const TON_PATH = "m/44'/607'/0'";

function autoConfirm(): ConfirmationPort {
  return {
    async confirm() {
      return true;
    },
    async getPassphrase() {
      return undefined;
    },
  };
}

function apdu(bytes: number[]): Uint8Array {
  return framePayload(TAG_APDU, Uint8Array.from(bytes), DEFAULT_MTU);
}

function swOf(payload: Uint8Array): number {
  return (payload[payload.length - 2]! << 8) | payload[payload.length - 1]!;
}

function bodyOf(payload: Uint8Array): Uint8Array {
  return payload.subarray(0, payload.length - 2);
}

async function exchange(handler: LedgerProtocolHandler, framed: Uint8Array): Promise<Uint8Array> {
  const incoming = splitFramedPackets(framed, DEFAULT_MTU);
  let outgoing: Uint8Array | null = null;
  for (const packet of incoming) {
    outgoing = await handler.handleWrite(packet);
  }
  expect(outgoing).not.toBeNull();
  const assembler = new BleReassembler();
  let assembled = null;
  for (const packet of splitFramedPackets(outgoing!, DEFAULT_MTU)) {
    assembled = assembler.push(packet);
  }
  expect(assembled).not.toBeNull();
  return assembled!.payload;
}

function handler(): LedgerProtocolHandler {
  const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
  return new LedgerProtocolHandler({
    model: nanoX,
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: mnemonicToEntropy(FOUNDATION, wordlist),
  });
}

function encodePath(components: number[]): number[] {
  const out = [components.length];
  for (const component of components) {
    out.push((component >>> 24) & 0xff, (component >>> 16) & 0xff, (component >>> 8) & 0xff, component & 0xff);
  }
  return out;
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u64(value: bigint): number[] {
  const out: number[] = [];
  let rest = value;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

const DEST = new Uint8Array(32).fill(0x11);

/** TRANSACTION.md tag 0 simple transfer. */
function simpleTransfer(opts?: {
  bounce?: number;
  sendMode?: number;
  seqno?: number;
  timeout?: number;
  value?: number[];
  payload?: { maxDepth: number; hash: Uint8Array };
  comment?: string;
  tag1?: { subwallet: number; includeOp: number };
}): number[] {
  const value = opts?.value ?? [];
  const body: number[] = [];
  if (opts?.tag1) {
    body.push(0x01, ...u32(opts.tag1.subwallet), opts.tag1.includeOp);
  } else {
    body.push(0x00);
  }
  body.push(
    ...u32(opts?.seqno ?? 1),
    ...u32(opts?.timeout ?? 0xffffffff),
    value.length,
    ...value,
    0x00,
    ...DEST,
    opts?.bounce ?? 1,
    opts?.sendMode ?? 3,
  );
  if (opts?.payload) {
    body.push(0x00, 0x01, ...u16(opts.payload.maxDepth), ...opts.payload.hash);
    if (opts.comment != null) {
      const comment = Array.from(new TextEncoder().encode(opts.comment));
      body.push(0x01, ...u32(HINT_COMMENT), ...u16(comment.length), ...comment);
    } else {
      body.push(0x00);
    }
  } else {
    body.push(0x00, 0x00, 0x00);
  }
  return body;
}

/**
 * Independent cell hash from the TON whitepaper / `hash_Cell` descriptor rule.
 * It does not use `BitString` from the implementation under test.
 */
function independentHashCell(bits: number[], refs: { maxDepth: number; hash: Uint8Array }[] = []): Uint8Array {
  const len = bits.length;
  const d1 = refs.length;
  const d2 = (len >> 3) + ((len + 7) >> 3);
  const padded = bits.slice();
  if (padded.length % 8 !== 0) {
    padded.push(1);
    while (padded.length % 8 !== 0) padded.push(0);
  }
  const data = new Uint8Array(padded.length / 8);
  for (let i = 0; i < padded.length; i += 1) {
    if (padded[i]) data[i >> 3] = data[i >> 3]! | (1 << (7 - (i % 8)));
  }
  const depths = refs.flatMap((ref) => [(ref.maxDepth >> 8) & 0xff, ref.maxDepth & 0xff]);
  const hashes = refs.map((ref) => ref.hash);
  return sha256(concatBytes(Uint8Array.of(d1, d2), data, Uint8Array.from(depths), ...hashes));
}

function pushUint(bits: number[], value: bigint | number, width: number): void {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  for (let i = 0; i < width; i += 1) {
    const shift = width - i - 1;
    bits.push(Number((v >> BigInt(shift)) & 1n));
  }
}

function pushBuffer(bits: number[], bytes: Uint8Array): void {
  for (const byte of bytes) pushUint(bits, byte, 8);
}

function independentSimpleOrderHash(opts: {
  bounce: number;
  sendMode: number;
  seqno: number;
  timeout: number;
  value: Uint8Array;
  dest: Uint8Array;
  subwallet: number;
  includeOp: boolean;
  payload?: { maxDepth: number; hash: Uint8Array };
}): Uint8Array {
  const msg: number[] = [];
  pushUint(msg, 0, 1);
  pushUint(msg, 1, 1);
  pushUint(msg, opts.bounce, 1);
  pushUint(msg, 0, 1);
  pushUint(msg, 0, 2);
  pushUint(msg, 2, 2);
  pushUint(msg, 0, 1);
  pushUint(msg, 0, 8);
  pushBuffer(msg, opts.dest);
  pushUint(msg, opts.value.length, 4);
  pushBuffer(msg, opts.value);
  pushUint(msg, 0, 1);
  pushUint(msg, 0, 4);
  pushUint(msg, 0, 4);
  pushUint(msg, 0, 64);
  pushUint(msg, 0, 32);
  const refs = [];
  if (opts.payload) {
    pushUint(msg, 0, 1);
    pushUint(msg, 1, 1);
    refs.push(opts.payload);
  } else {
    pushUint(msg, 0, 1);
    pushUint(msg, 0, 1);
  }
  const internal = {
    maxDepth: opts.payload ? opts.payload.maxDepth + 1 : 0,
    hash: independentHashCell(msg, refs),
  };
  const order: number[] = [];
  pushUint(order, opts.subwallet, 32);
  pushUint(order, opts.timeout, 32);
  pushUint(order, opts.seqno, 32);
  if (opts.includeOp) pushUint(order, 0, 8);
  pushUint(order, opts.sendMode, 8);
  return independentHashCell(order, [internal]);
}

function commentCellHash(comment: string): Uint8Array {
  const bits: number[] = [];
  pushUint(bits, 0, 32);
  pushBuffer(bits, new TextEncoder().encode(comment));
  return independentHashCell(bits);
}

function plaintextCellHash(text: string): Uint8Array {
  const bits: number[] = [];
  pushBuffer(bits, new TextEncoder().encode(text));
  return independentHashCell(bits);
}

describe('TON cell hash (hash.c / cell.c)', () => {
  it('hashes a Wallet V4R2 simple transfer, not sha256 of the APDU', () => {
    const payload = Uint8Array.from(simpleTransfer({ value: [0x01] }));
    const tx = deserializeTonTx(payload);
    expect(tx).not.toBeNull();
    const hash = hashTonTx(tx!);
    const expected = independentSimpleOrderHash({
      bounce: 1,
      sendMode: 3,
      seqno: 1,
      timeout: 0xffffffff,
      value: Uint8Array.of(0x01),
      dest: DEST,
      subwallet: DEFAULT_SUBWALLET_ID,
      includeOp: true,
    });
    expect(Array.from(hash!)).toEqual(Array.from(expected));
    expect(Array.from(hash!)).not.toEqual(Array.from(sha256(payload)));
  });

  it('hashes tag 0x01 with a custom subwallet and no wallet op', () => {
    const payload = Uint8Array.from(
      simpleTransfer({ tag1: { subwallet: 42, includeOp: 0 }, seqno: 7, sendMode: 1, bounce: 0 }),
    );
    const hash = hashTonTx(deserializeTonTx(payload)!);
    const expected = independentSimpleOrderHash({
      bounce: 0,
      sendMode: 1,
      seqno: 7,
      timeout: 0xffffffff,
      value: new Uint8Array(),
      dest: DEST,
      subwallet: 42,
      includeOp: false,
    });
    expect(Array.from(hash!)).toEqual(Array.from(expected));
    expect(Array.from(hash!)).not.toEqual(Array.from(sha256(payload)));
  });

  it('hashes a payload cell ref when the comment hint matches', () => {
    const comment = 'hello';
    const payloadHash = commentCellHash(comment);
    const payload = Uint8Array.from(
      simpleTransfer({ payload: { maxDepth: 0, hash: payloadHash }, comment }),
    );
    const tx = deserializeTonTx(payload);
    expect(tx?.isBlind).toBe(false);
    const hash = hashTonTx(tx!);
    const expected = independentSimpleOrderHash({
      bounce: 1,
      sendMode: 3,
      seqno: 1,
      timeout: 0xffffffff,
      value: new Uint8Array(),
      dest: DEST,
      subwallet: DEFAULT_SUBWALLET_ID,
      includeOp: true,
      payload: { maxDepth: 0, hash: payloadHash },
    });
    expect(Array.from(hash!)).toEqual(Array.from(expected));
    expect(Array.from(hash!)).not.toEqual(Array.from(sha256(payload)));
  });

  it('rejects a comment hint whose cell hash is not the payload hash', () => {
    const payload = Uint8Array.from(
      simpleTransfer({
        payload: { maxDepth: 0, hash: new Uint8Array(32).fill(0xaa) },
        comment: 'hello',
      }),
    );
    expect(deserializeTonTx(payload)).toBeNull();
  });
});

describe('TON SIGN_DATA plaintext (sign_data_deserialize.c)', () => {
  it('signs schema_crc||timestamp||cell_hash, not sha256 of the APDU', () => {
    const text = 'hello';
    const timestamp = 1_700_000_000n;
    const wire = concatBytes(Uint8Array.from([0x75, 0x4b, 0xf9, 0x1b, ...u64(timestamp)]), new TextEncoder().encode(text));
    const parsed = deserializeTonSignData(wire);
    const cellHash = plaintextCellHash(text);
    expect(parsed).not.toBeNull();
    expect(Array.from(parsed!.cellHash)).toEqual(Array.from(cellHash));
    expect(Array.from(parsed!.signMessage)).toEqual(
      Array.from(concatBytes(Uint8Array.from([0x75, 0x4b, 0xf9, 0x1b, ...u64(timestamp)]), cellHash)),
    );
    expect(Array.from(parsed!.cellHash)).not.toEqual(Array.from(sha256(wire)));
    expect(parsed!.schemaCrc).toBe(PLAINTEXT_REQUEST);
  });
});

describe('TON GET_ADDRESS_PROOF (proof_deserialize.c)', () => {
  it('hashes ton-proof-item-v2 then ff ff ton-connect, not sha256 of the APDU', () => {
    const publicKey = new Uint8Array(32).fill(0x22);
    const addressHash = pubkeyToHash(publicKey, DEFAULT_SUBWALLET_ID, false);
    const domain = new TextEncoder().encode('example.com');
    const timestamp = 1_700_000_000n;
    const payload = new TextEncoder().encode('nonce');
    const hash = tonConnectProofHash({
      workchain: 0,
      addressHash,
      domain,
      timestamp,
      payload,
    });
    const apdu = concatBytes(domain, payload);
    expect(Array.from(hash)).not.toEqual(Array.from(sha256(apdu)));
    const tsLe = new Uint8Array(8);
    let rest = timestamp;
    for (let i = 0; i < 8; i += 1) {
      tsLe[i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    const expectedInner = sha256(
      concatBytes(
        new TextEncoder().encode('ton-proof-item-v2/'),
        new Uint8Array(4),
        addressHash,
        Uint8Array.of(domain.length, 0, 0, 0),
        domain,
        tsLe,
        payload,
      ),
    );
    const expected = sha256(
      concatBytes(Uint8Array.of(0xff, 0xff), new TextEncoder().encode('ton-connect'), expectedInner),
    );
    expect(Array.from(hash)).toEqual(Array.from(expected));
  });
});

describe('TON APDU sign/verify', () => {
  const pathBytes = encodePath([0x8000002c, 0x8000025f, 0x80000000]);
  const seed = mnemonicToSeedSync(FOUNDATION, '');
  const privateKey = deriveEd25519PrivateKeyFromSeed(seed, TON_PATH);
  const publicKey = ed25519PublicKey(privateKey);

  async function signTx(payload: number[]): Promise<Uint8Array> {
    const device = handler();
    device.setApp('ton');
    const first = await exchange(device, apdu([0xe0, 0x06, 0x00, 0x03, pathBytes.length, ...pathBytes]));
    expect(swOf(first)).toBe(SW_OK);
    return exchange(device, apdu([0xe0, 0x06, 0x00, 0x00, payload.length, ...payload]));
  }

  it('SIGN_TX returns a 98-byte sig||cell-hash and verifies over the cell hash', async () => {
    const payload = simpleTransfer({ value: [0x01] });
    const reply = await signTx(payload);
    expect(swOf(reply)).toBe(SW_OK);
    const body = bodyOf(reply);
    expect(body[0]).toBe(64);
    expect(body[65]).toBe(32);
    expect(body.length).toBe(98);
    const signature = body.subarray(1, 65);
    const hash = body.subarray(66, 98);
    const expected = hashTonTx(deserializeTonTx(Uint8Array.from(payload))!);
    expect(Array.from(hash)).toEqual(Array.from(expected!));
    expect(Array.from(hash)).not.toEqual(Array.from(sha256(Uint8Array.from(payload))));
    expect(Array.from(signature)).toEqual(Array.from(signEd25519(privateKey, hash)));
    expect(ed25519.verify(signature, hash, publicKey)).toBe(true);
    expect(ed25519.verify(signature, sha256(Uint8Array.from(payload)), publicKey)).toBe(false);
  });

  it('SIGN_TX with a payload and no hints is BD00 because settings are off', async () => {
    const payload = simpleTransfer({ payload: { maxDepth: 0, hash: new Uint8Array(32).fill(1) } });
    const reply = await signTx(payload);
    expect(swOf(reply)).toBe(SW_TON_BLIND_SIGNING_DISABLED);
  });

  it('SIGN_TX garbage is B010, not a sha256 signature', async () => {
    const reply = await signTx([0x01, 0x02, 0x03, 0x04]);
    expect(swOf(reply)).toBe(SW_TON_TX_PARSING_FAIL);
    expect(reply.length).toBe(2);
  });

  it('SIGN_DATA plaintext verifies over crc||timestamp||cell_hash and returns the cell hash', async () => {
    const text = 'hello';
    const timestamp = 1_700_000_000n;
    const wire = [0x75, 0x4b, 0xf9, 0x1b, ...u64(timestamp), ...new TextEncoder().encode(text)];
    const device = handler();
    device.setApp('ton');
    const first = await exchange(device, apdu([0xe0, 0x09, 0x00, 0x03, pathBytes.length, ...pathBytes]));
    expect(swOf(first)).toBe(SW_OK);
    const reply = await exchange(device, apdu([0xe0, 0x09, 0x00, 0x00, wire.length, ...wire]));
    expect(swOf(reply)).toBe(SW_OK);
    const body = bodyOf(reply);
    expect(body.length).toBe(98);
    const signature = body.subarray(1, 65);
    const hash = body.subarray(66, 98);
    const parsed = deserializeTonSignData(Uint8Array.from(wire))!;
    expect(Array.from(hash)).toEqual(Array.from(parsed.cellHash));
    expect(Array.from(hash)).not.toEqual(Array.from(sha256(Uint8Array.from(wire))));
    expect(ed25519.verify(signature, parsed.signMessage, publicKey)).toBe(true);
    expect(ed25519.verify(signature, hash, publicKey)).toBe(false);
    expect(ed25519.verify(signature, sha256(Uint8Array.from(wire)), publicKey)).toBe(false);
  });

  it('SIGN_DATA unknown schema is B011', async () => {
    const device = handler();
    device.setApp('ton');
    await exchange(device, apdu([0xe0, 0x09, 0x00, 0x03, pathBytes.length, ...pathBytes]));
    const reply = await exchange(device, apdu([0xe0, 0x09, 0x00, 0x00, 4, 0x00, 0x00, 0x00, 0x01]));
    expect(swOf(reply)).toBe(SW_TON_SIGN_DATA_PARSING_FAIL);
  });

  it('GET_ADDRESS_PROOF verifies over the TON Connect hash', async () => {
    const domain = Array.from(new TextEncoder().encode('example.com'));
    const timestamp = u64(1_700_000_000n);
    const nonce = Array.from(new TextEncoder().encode('nonce'));
    const data = [...pathBytes, domain.length, ...domain, ...timestamp, ...nonce];
    const device = handler();
    device.setApp('ton');
    const reply = await exchange(device, apdu([0xe0, 0x08, 0x01, 0x00, data.length, ...data]));
    expect(swOf(reply)).toBe(SW_OK);
    const body = bodyOf(reply);
    expect(body.length).toBe(98);
    const signature = body.subarray(1, 65);
    const hash = body.subarray(66, 98);
    const expected = tonConnectProofHash({
      workchain: 0,
      addressHash: pubkeyToHash(publicKey, DEFAULT_SUBWALLET_ID, false),
      domain: Uint8Array.from(domain),
      timestamp: 1_700_000_000n,
      payload: Uint8Array.from(nonce),
    });
    expect(Array.from(hash)).toEqual(Array.from(expected));
    expect(Array.from(hash)).not.toEqual(Array.from(sha256(Uint8Array.from(data))));
    expect(ed25519.verify(signature, hash, publicKey)).toBe(true);
    expect(ed25519.verify(signature, sha256(Uint8Array.from(data)), publicKey)).toBe(false);
  });
});
