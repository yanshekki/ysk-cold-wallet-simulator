import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { ed25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS } from '@cws/contracts';
import { SW_DENY, SW_OK } from '../apdu';
import { concatBytes } from '../bytes';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { deriveIcarus, signIcarus } from './icarus';
import { cardanoCanonicalBody, cardanoCanonicalTxHash } from './cardanoTxHash';
import type { FamilyContext } from './generic';

const FOUNDATION = 'test test test test test test test test test test test junk';

function u16(value: number): Uint8Array {
  return Uint8Array.of((value >> 8) & 0xff, value & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = value;
  for (let index = 7; index >= 0; index -= 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** Independent CBOR writer. It is not the implementation under test. */
function cborUnsigned(value: bigint): Uint8Array {
  if (value < 24n) return Uint8Array.of(Number(value));
  if (value < 256n) return Uint8Array.of(0x18, Number(value));
  if (value < 65536n) return Uint8Array.of(0x19, Number((value >> 8n) & 0xffn), Number(value & 0xffn));
  return Uint8Array.of(
    0x1a,
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  );
}

function cborMajor(major: number, value: bigint): Uint8Array {
  const head = cborUnsigned(value);
  const out = new Uint8Array(head);
  out[0] = (out[0] ?? 0) | (major << 5);
  return out;
}

function cborBytes(data: Uint8Array): Uint8Array {
  return concatBytes(cborMajor(2, BigInt(data.length)), data);
}

function paymentWire(): { init: Uint8Array; raw: Uint8Array; body: Uint8Array } {
  const txHash = new Uint8Array(32).fill(0x11);
  const address = concatBytes(Uint8Array.of(0x61), new Uint8Array(28).fill(0x22));
  const output = concatBytes(
    Uint8Array.of(1),
    u16(address.length),
    address,
    u64(1_000_000n),
    Uint8Array.of(1, 0x01, 0x01),
    u16(0),
  );
  const raw = concatBytes(txHash, u32(0), u16(output.length), output, u64(170_000n), u64(1_000n));
  const aux = new Uint8Array(32).fill(0xab);
  const init = concatBytes(
    u64(1n),
    Uint8Array.of(1),
    u32(1),
    Uint8Array.of(3),
    u16(1),
    u16(1),
    Uint8Array.of(0x02),
    u16(0),
    u16(0),
    Uint8Array.of(0x02, 0),
    aux,
    Uint8Array.of(0x01),
    u16(0),
    Uint8Array.of(0x01),
    u16(0),
    u16(0),
    Uint8Array.of(0x02, 0x01, 0x01),
    u16(0),
    u16(0),
    Uint8Array.of(0x01, 0x01),
    u16(1),
    u16(raw.length),
  );
  const input = concatBytes(cborMajor(4, 2n), cborBytes(txHash), cborUnsigned(0n));
  const outputCbor = concatBytes(
    cborMajor(5, 2n),
    cborUnsigned(0n),
    cborBytes(address),
    cborUnsigned(1n),
    cborUnsigned(1_000_000n),
  );
  const body = concatBytes(
    cborMajor(5, 6n),
    cborUnsigned(0n),
    cborMajor(6, 258n),
    cborMajor(4, 1n),
    input,
    cborUnsigned(1n),
    cborMajor(4, 1n),
    outputCbor,
    cborUnsigned(2n),
    cborUnsigned(170_000n),
    cborUnsigned(3n),
    cborUnsigned(1_000n),
    cborUnsigned(7n),
    cborBytes(aux),
    cborUnsigned(15n),
    cborUnsigned(1n),
  );
  return { init, raw, body };
}

async function roundTrip(device: LedgerProtocolHandler, apdu: Uint8Array): Promise<Uint8Array> {
  const framed = framePayload(TAG_APDU, apdu, DEFAULT_MTU);
  let outgoing: Uint8Array | null = null;
  for (const packet of splitFramedPackets(framed, DEFAULT_MTU)) {
    outgoing = await device.handleWrite(packet);
  }
  const assembler = new BleReassembler();
  let assembled = null;
  for (const packet of splitFramedPackets(outgoing!, DEFAULT_MTU)) {
    assembled = assembler.push(packet);
  }
  return assembled!.payload;
}

function ctx(): FamilyContext {
  return {
    confirmation: {
      async confirm() {
        return true;
      },
      async getPassphrase() {
        return undefined;
      },
    },
    slotId: 'slot',
    entropy: mnemonicToEntropy(FOUNDATION, wordlist),
  };
}

describe('Cardano canonical transaction body', () => {
  it('hashes the canonical body, not the concatenated APDU payload', async () => {
    const { init, raw, body } = paymentWire();
    expect(Array.from(body.slice(0, 6))).toEqual([0xa6, 0x00, 0xd9, 0x01, 0x02, 0x81]);
    const built = await cardanoCanonicalBody(init, raw, ctx());
    expect(built).not.toBeNull();
    expect(Array.from(built!)).toEqual(Array.from(body));
    expect(Array.from(blake2b(built!, { dkLen: 32 }))).not.toEqual(Array.from(blake2b(raw, { dkLen: 32 })));
  });

  it('includes collateral, a script-data hash, a datum, and a token the way a swap does', async () => {
    const txHash = new Uint8Array(32).fill(0x31);
    const scriptHash = new Uint8Array(32).fill(0x44);
    const datum = new Uint8Array(32).fill(0x55);
    const policy = new Uint8Array(28).fill(0x66);
    const address = concatBytes(Uint8Array.of(0x71), new Uint8Array(28).fill(0x77));
    const output = concatBytes(
      Uint8Array.of(1),
      u16(address.length),
      address,
      u64(2_000_000n),
      Uint8Array.of(1, 0x02, 0x01),
      u16(1),
      policy,
      u16(1),
      Uint8Array.of(4),
      Uint8Array.of(0x4e, 0x49, 0x47, 0x48),
      u64(50n),
      Uint8Array.of(0),
      datum,
    );
    const raw = concatBytes(
      txHash,
      u32(1),
      u16(output.length),
      output,
      u64(200_000n),
      scriptHash,
      txHash,
      u32(2),
      u64(1_500_000n),
      txHash,
      u32(3),
    );
    const init = concatBytes(
      u64(1n),
      Uint8Array.of(1),
      u32(764824073),
      Uint8Array.of(7),
      u16(1),
      u16(1),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      Uint8Array.of(0x02),
      u16(1),
      u16(0),
      Uint8Array.of(0x02),
      Uint8Array.of(0x01),
      Uint8Array.of(0x02),
      u16(1),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(raw.length),
    );
    const token = concatBytes(cborBytes(policy), cborMajor(5, 1n), cborBytes(Uint8Array.of(0x4e, 0x49, 0x47, 0x48)), cborUnsigned(50n));
    const outputCbor = concatBytes(
      cborMajor(5, 3n),
      cborUnsigned(0n),
      cborBytes(address),
      cborUnsigned(1n),
      cborMajor(4, 2n),
      cborUnsigned(2_000_000n),
      cborMajor(5, 1n),
      token,
      cborUnsigned(2n),
      cborMajor(4, 2n),
      cborUnsigned(0n),
      cborBytes(datum),
    );
    const input = (index: number) => concatBytes(cborMajor(4, 2n), cborBytes(txHash), cborUnsigned(BigInt(index)));
    const body = concatBytes(
      cborMajor(5, 8n),
      cborUnsigned(0n),
      cborMajor(6, 258n),
      cborMajor(4, 1n),
      input(1),
      cborUnsigned(1n),
      cborMajor(4, 1n),
      outputCbor,
      cborUnsigned(2n),
      cborUnsigned(200_000n),
      cborUnsigned(11n),
      cborBytes(scriptHash),
      cborUnsigned(13n),
      cborMajor(6, 258n),
      cborMajor(4, 1n),
      input(2),
      cborUnsigned(15n),
      cborUnsigned(1n),
      cborUnsigned(17n),
      cborUnsigned(1_500_000n),
      cborUnsigned(18n),
      cborMajor(6, 258n),
      cborMajor(4, 1n),
      input(3),
    );
    const built = await cardanoCanonicalBody(init, raw, ctx());
    expect(Array.from(built ?? new Uint8Array())).toEqual(Array.from(body));
  });

  it('signs the canonical digest so a node can verify the witness', async () => {
    const { init, raw, body } = paymentWire();
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: ctx().confirmation,
      slotId: 'slot',
      entropy: ctx().entropy,
    });
    device.setApp('cardano');
    const send = (data: Uint8Array, p1: number) =>
      roundTrip(device, Uint8Array.from([0xd7, 0x21, p1, 0x00, data.length, ...data]));
    expect((await send(init, 0x10)).slice(-2)).toEqual(Uint8Array.of(0x90, 0x00));
    const confirmed = await send(raw, 0x12);
    expect(confirmed.slice(-2)).toEqual(Uint8Array.of(0x90, 0x00));
    const hash = confirmed.slice(0, 32);
    expect(Array.from(hash)).toEqual(Array.from(blake2b(body, { dkLen: 32 })));
    expect(Array.from(hash)).not.toEqual(Array.from(blake2b(raw, { dkLen: 32 })));
    const path = Uint8Array.of(
      0x05,
      0x80, 0x00, 0x07, 0x3c,
      0x80, 0x00, 0x07, 0x17,
      0x80, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    );
    const witness = await send(path, 0x0f);
    expect((witness[witness.length - 2]! << 8) | witness[witness.length - 1]!).toBe(SW_OK);
    const node = deriveIcarus(ctx().entropy, "m/1852'/1815'/0'/0/0");
    const signature = witness.slice(0, 64);
    expect(Array.from(signature)).toEqual(Array.from(signIcarus(node, hash)));
    expect(ed25519.verify(signature, hash, node.publicKey)).toBe(true);
    expect(ed25519.verify(signature, blake2b(raw, { dkLen: 32 }), node.publicKey)).toBe(false);
  });

  it('a denied canonical confirm returns 6985 and does not sign', async () => {
    const { init, raw } = paymentWire();
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm() {
          return false;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: ctx().entropy,
    });
    device.setApp('cardano');
    const send = (data: Uint8Array, p1: number) =>
      roundTrip(device, Uint8Array.from([0xd7, 0x21, p1, 0x00, data.length, ...data]));
    await send(init, 0x10);
    const denied = await send(raw, 0x12);
    expect((denied[denied.length - 2]! << 8) | denied[denied.length - 1]!).toBe(SW_DENY);
    expect(denied.length).toBe(2);
  });

  it('splits the raw stream across CHUNK and CONFIRM and still hashes the body', async () => {
    const { init, raw, body } = paymentWire();
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: ctx().confirmation,
      slotId: 'slot',
      entropy: ctx().entropy,
    });
    device.setApp('cardano');
    const send = (data: Uint8Array, p1: number) =>
      roundTrip(device, Uint8Array.from([0xd7, 0x21, p1, 0x00, data.length, ...data]));
    expect((await send(init, 0x10)).slice(-2)).toEqual(Uint8Array.of(0x90, 0x00));
    expect((await send(raw.slice(0, 40), 0x11)).slice(-2)).toEqual(Uint8Array.of(0x90, 0x00));
    const confirmed = await send(raw.slice(40), 0x12);
    expect(confirmed.slice(-2)).toEqual(Uint8Array.of(0x90, 0x00));
    const hash = confirmed.slice(0, 32);
    expect(Array.from(hash)).toEqual(Array.from(blake2b(body, { dkLen: 32 })));
    expect(Array.from(hash)).not.toEqual(Array.from(blake2b(concatBytes(init, raw), { dkLen: 32 })));
  });

  it('hashes a device-owned change output and a path required signer from the payment key', async () => {
    const hard = 0x80000000;
    const pay = [1852 | hard, 1815 | hard, hard, 0, 0];
    const stake = [1852 | hard, 1815 | hard, hard, 2, 0];
    const path = (parts: number[]) => {
      const bytes = [parts.length];
      for (const part of parts) {
        bytes.push((part >>> 24) & 0xff, (part >>> 16) & 0xff, (part >>> 8) & 0xff, part & 0xff);
      }
      return Uint8Array.from(bytes);
    };
    const payment = deriveIcarus(ctx().entropy, "m/1852'/1815'/0'/0/0");
    const staking = deriveIcarus(ctx().entropy, "m/1852'/1815'/0'/2/0");
    const paymentHash = blake2b(payment.publicKey, { dkLen: 28 });
    const stakeHash = blake2b(staking.publicKey, { dkLen: 28 });
    const address = concatBytes(Uint8Array.of(0x01), paymentHash, stakeHash);
    const txHash = new Uint8Array(32).fill(0x21);
    const output = concatBytes(
      Uint8Array.of(2, 0x00, 0x01),
      path(pay),
      Uint8Array.of(0x22),
      path(stake),
      u64(5_000_000n),
      Uint8Array.of(1, 0x01, 0x01),
      u16(0),
    );
    const stakeKey = new Uint8Array(28).fill(0x3c);
    const raw = concatBytes(
      txHash,
      u32(4),
      u16(output.length),
      output,
      u64(180_000n),
      u64(2n),
      Uint8Array.of(0),
      stakeKey,
      Uint8Array.of(0),
      path(pay),
    );
    const init = concatBytes(
      u64(1n),
      Uint8Array.of(1),
      u32(764824073),
      Uint8Array.of(7),
      u16(1),
      u16(1),
      Uint8Array.of(0x01),
      u16(0),
      u16(1),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      Uint8Array.of(0x01),
      u16(0),
      u16(1),
      Uint8Array.of(0x02),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(1),
      u16(raw.length),
    );
    const input = concatBytes(cborMajor(4, 2n), cborBytes(txHash), cborUnsigned(4n));
    const outputCbor = concatBytes(
      cborMajor(5, 2n),
      cborUnsigned(0n),
      cborBytes(address),
      cborUnsigned(1n),
      cborUnsigned(5_000_000n),
    );
    const reward = concatBytes(Uint8Array.of(0xe1), stakeKey);
    const body = concatBytes(
      cborMajor(5, 6n),
      cborUnsigned(0n),
      cborMajor(6, 258n),
      cborMajor(4, 1n),
      input,
      cborUnsigned(1n),
      cborMajor(4, 1n),
      outputCbor,
      cborUnsigned(2n),
      cborUnsigned(180_000n),
      cborUnsigned(5n),
      cborMajor(5, 1n),
      cborBytes(reward),
      cborUnsigned(2n),
      cborUnsigned(14n),
      cborMajor(6, 258n),
      cborMajor(4, 1n),
      cborBytes(paymentHash),
      cborUnsigned(15n),
      cborUnsigned(1n),
    );
    const built = await cardanoCanonicalBody(init, raw, ctx());
    expect(Array.from(built ?? new Uint8Array())).toEqual(Array.from(body));
    const hash = await cardanoCanonicalTxHash(init, raw, ctx());
    expect(Array.from(hash ?? new Uint8Array())).not.toEqual(Array.from(blake2b(raw, { dkLen: 32 })));
  });

  it('encodes a negative mint as a canonical CBOR negative integer', async () => {
    const txHash = new Uint8Array(32).fill(0x41);
    const address = concatBytes(Uint8Array.of(0x61), new Uint8Array(28).fill(0x42));
    const output = concatBytes(
      Uint8Array.of(1),
      u16(address.length),
      address,
      u64(1_000_000n),
      Uint8Array.of(1, 0x01, 0x01),
      u16(0),
    );
    const policy = new Uint8Array(28).fill(0x43);
    const raw = concatBytes(
      txHash,
      u32(0),
      u16(output.length),
      output,
      u64(170_000n),
      policy,
      u16(1),
      Uint8Array.of(1, 0x4e),
      u64(0xffffffffffffffffn),
    );
    const init = concatBytes(
      u64(0n),
      Uint8Array.of(1),
      u32(764824073),
      Uint8Array.of(3),
      u16(1),
      u16(1),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(1),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(raw.length),
    );
    const built = await cardanoCanonicalBody(init, raw, ctx());
    expect(built).not.toBeNull();
    const bytes = Array.from(built!);
    expect(bytes.slice(-3)).toEqual([0x41, 0x4e, 0x20]);
    expect(bytes.includes(0x3b)).toBe(false);
  });

  it('fails closed on CIP-36 registration, a pool certificate, and voting procedures', async () => {
    const { raw } = paymentWire();
    const cip36 = paymentWire().init;
    const marker = cip36.indexOf(0xab);
    expect(cip36[marker - 1]).toBe(0);
    const withoutHash = concatBytes(cip36.slice(0, marker - 1), Uint8Array.of(1), cip36.slice(marker + 32));
    expect(await cardanoCanonicalBody(withoutHash, raw, ctx())).toBeNull();

    const txHash = new Uint8Array(32).fill(0x11);
    const address = concatBytes(Uint8Array.of(0x61), new Uint8Array(28).fill(0x22));
    const output = concatBytes(
      Uint8Array.of(1),
      u16(address.length),
      address,
      u64(1_000_000n),
      Uint8Array.of(1, 0x01, 0x01),
      u16(0),
    );
    const pooled = concatBytes(txHash, u32(0), u16(output.length), output, u64(170_000n), Uint8Array.of(3));
    const poolInit = concatBytes(
      u64(1n),
      Uint8Array.of(1),
      u32(1),
      Uint8Array.of(3),
      u16(1),
      u16(1),
      Uint8Array.of(0x01),
      u16(1),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(pooled.length),
    );
    expect(await cardanoCanonicalBody(poolInit, pooled, ctx())).toBeNull();

    const voters = concatBytes(
      u64(1n),
      Uint8Array.of(1),
      u32(1),
      Uint8Array.of(3),
      u16(1),
      u16(1),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      Uint8Array.of(0x01),
      u16(0),
      u16(0),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(1),
      Uint8Array.of(0x01),
      Uint8Array.of(0x01),
      u16(0),
      u16(raw.length),
    );
    expect(await cardanoCanonicalTxHash(voters, raw, ctx())).toBeNull();

    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: ctx().confirmation,
      slotId: 'slot',
      entropy: ctx().entropy,
    });
    device.setApp('cardano');
    const send = (data: Uint8Array, p1: number) =>
      roundTrip(device, Uint8Array.from([0xd7, 0x21, p1, 0x00, data.length, ...data]));
    await send(withoutHash, 0x10);
    const rejected = await send(raw, 0x12);
    expect((rejected[rejected.length - 2]! << 8) | rejected[rejected.length - 1]!).toBe(0x6a80);
    expect(rejected.length).toBe(2);
  });
});
