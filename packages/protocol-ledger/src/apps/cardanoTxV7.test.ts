import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { ed25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, resetLedgerVersionPicks, setLedgerVersionPicks } from '@cws/contracts';
import { SW_OK } from '../apdu';
import { concatBytes } from '../bytes';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { deriveIcarus, signIcarus } from './icarus';
import { CardanoV7Tx } from './cardanoTxV7';
import type { FamilyContext } from './generic';

const FOUNDATION = 'test test test test test test test test test test test junk';

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

function path(parts: number[]): Uint8Array {
  const bytes = [parts.length];
  for (const part of parts) {
    bytes.push((part >>> 24) & 0xff, (part >>> 16) & 0xff, (part >>> 8) & 0xff, part & 0xff);
  }
  return Uint8Array.from(bytes);
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

/** 7.2.1 stage stream shaped like a Minswap swap, plus the body Ledger hashes. */
function swap721(): { stages: { p1: number; p2: number; data: Uint8Array }[]; body: Uint8Array } {
  const hard = 0x80000000;
  const pay = [1852 | hard, 1815 | hard, hard, 0, 0];
  const stake = [1852 | hard, 1815 | hard, hard, 2, 0];
  const payment = deriveIcarus(ctx().entropy, "m/1852'/1815'/0'/0/0");
  const staking = deriveIcarus(ctx().entropy, "m/1852'/1815'/0'/2/0");
  const paymentHash = blake2b(payment.publicKey, { dkLen: 28 });
  const stakeHash = blake2b(staking.publicKey, { dkLen: 28 });
  const change = concatBytes(Uint8Array.of(0x01), paymentHash, stakeHash);
  const txHash = new Uint8Array(32).fill(0x31);
  const scriptAddress = concatBytes(Uint8Array.of(0x71), new Uint8Array(28).fill(0x77));
  const policy = new Uint8Array(28).fill(0x66);
  const datum = new Uint8Array(32).fill(0x55);
  const aux = new Uint8Array(32).fill(0xab);
  const scriptHash = new Uint8Array(32).fill(0x44);
  const name = Uint8Array.of(0x4e, 0x49, 0x47, 0x48);
  const init = concatBytes(
    u64(1n),
    Uint8Array.of(1),
    u32(764824073),
    Uint8Array.of(0x02, 0x02, 0x01, 0x01, 0x02, 0x02, 0x01, 0x02, 0x01, 0x01),
    Uint8Array.of(7),
    u32(1),
    u32(2),
    u32(0),
    u32(0),
    u32(1),
    u32(1),
    u32(1),
    u32(0),
    u32(1),
  );
  const scriptBasic = concatBytes(
    Uint8Array.of(1, 1),
    u32(scriptAddress.length),
    scriptAddress,
    u64(2_000_000n),
    u32(1),
    Uint8Array.of(0x02, 0x01),
  );
  const changeBasic = concatBytes(
    Uint8Array.of(1, 2, 0x00, 0x01),
    path(pay),
    Uint8Array.of(0x22),
    path(stake),
    u64(5_000_000n),
    u32(0),
    Uint8Array.of(0x01, 0x01),
  );
  const stages = [
    { p1: 0x01, p2: 0x00, data: init },
    { p1: 0x08, p2: 0x00, data: concatBytes(Uint8Array.of(0), aux) },
    { p1: 0x02, p2: 0x00, data: concatBytes(txHash, u32(1)) },
    { p1: 0x03, p2: 0x30, data: scriptBasic },
    { p1: 0x03, p2: 0x31, data: concatBytes(policy, u32(1)) },
    { p1: 0x03, p2: 0x32, data: concatBytes(u32(name.length), name, u64(50n)) },
    { p1: 0x03, p2: 0x34, data: concatBytes(Uint8Array.of(0), datum) },
    { p1: 0x03, p2: 0x33, data: new Uint8Array() },
    { p1: 0x03, p2: 0x30, data: changeBasic },
    { p1: 0x03, p2: 0x33, data: new Uint8Array() },
    { p1: 0x04, p2: 0x00, data: u64(200_000n) },
    { p1: 0x05, p2: 0x00, data: u64(1_000n) },
    { p1: 0x0c, p2: 0x00, data: scriptHash },
    { p1: 0x0d, p2: 0x00, data: concatBytes(txHash, u32(2)) },
    { p1: 0x0e, p2: 0x00, data: concatBytes(Uint8Array.of(0), path(pay)) },
    { p1: 0x10, p2: 0x00, data: u64(1_500_000n) },
    { p1: 0x11, p2: 0x00, data: concatBytes(txHash, u32(3)) },
  ];
  const input = (index: number) => concatBytes(cborMajor(4, 2n), cborBytes(txHash), cborUnsigned(BigInt(index)));
  const token = concatBytes(
    cborBytes(policy),
    cborMajor(5, 1n),
    cborBytes(name),
    cborUnsigned(50n),
  );
  const scriptOut = concatBytes(
    cborMajor(5, 3n),
    cborUnsigned(0n),
    cborBytes(scriptAddress),
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
  const changeOut = concatBytes(
    cborMajor(5, 2n),
    cborUnsigned(0n),
    cborBytes(change),
    cborUnsigned(1n),
    cborUnsigned(5_000_000n),
  );
  const body = concatBytes(
    cborMajor(5, 11n),
    cborUnsigned(0n),
    cborMajor(6, 258n),
    cborMajor(4, 1n),
    input(1),
    cborUnsigned(1n),
    cborMajor(4, 2n),
    scriptOut,
    changeOut,
    cborUnsigned(2n),
    cborUnsigned(200_000n),
    cborUnsigned(3n),
    cborUnsigned(1_000n),
    cborUnsigned(7n),
    cborBytes(aux),
    cborUnsigned(11n),
    cborBytes(scriptHash),
    cborUnsigned(13n),
    cborMajor(6, 258n),
    cborMajor(4, 1n),
    input(2),
    cborUnsigned(14n),
    cborMajor(6, 258n),
    cborMajor(4, 1n),
    cborBytes(paymentHash),
    cborUnsigned(15n),
    cborUnsigned(1n),
    cborUnsigned(17n),
    cborUnsigned(1_500_000n),
    cborUnsigned(18n),
    cborMajor(6, 258n),
    cborMajor(4, 1n),
    input(3),
  );
  return { stages, body };
}

describe('Cardano 7.2.1 stage hash', () => {
  it('hashes a Minswap-shaped 7.2.1 swap, not the concatenated stages', async () => {
    const { stages, body } = swap721();
    const machine = new CardanoV7Tx('7.2.1');
    for (const stage of stages) {
      await machine.stage(stage.p1, stage.p2, stage.data, ctx());
    }
    const built = machine.body();
    expect(built).not.toBeNull();
    expect(Array.from(built!)).toEqual(Array.from(body));
    const raw = concatBytes(...stages.map((stage) => stage.data));
    expect(Array.from(blake2b(built!, { dkLen: 32 }))).not.toEqual(Array.from(blake2b(raw, { dkLen: 32 })));
  });

  it('signs that digest when the catalog is 7.2.1 or still 8.x', async () => {
    const { stages, body } = swap721();
    const hash = blake2b(body, { dkLen: 32 });
    for (const version of [undefined, '7.2.1'] as const) {
      if (version) setLedgerVersionPicks({ cardano: version });
      else resetLedgerVersionPicks();
      try {
        const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
        const device = new LedgerProtocolHandler({
          model: nanoX,
          confirmation: ctx().confirmation,
          slotId: 'slot',
          entropy: ctx().entropy,
        });
        device.setApp('cardano');
        const send = (data: Uint8Array, p1: number, p2 = 0) =>
          roundTrip(device, Uint8Array.from([0xd7, 0x21, p1, p2, data.length, ...data]));
        for (const stage of stages) {
          const reply = await send(stage.data, stage.p1, stage.p2);
          expect(reply.slice(-2)).toEqual(Uint8Array.of(0x90, 0x00));
        }
        const confirmed = await send(new Uint8Array(), 0x0a);
        expect((confirmed[confirmed.length - 2]! << 8) | confirmed[confirmed.length - 1]!).toBe(SW_OK);
        expect(Array.from(confirmed.slice(0, 32))).toEqual(Array.from(hash));
        const witnessPath = path([0x8000073c, 0x80000717, 0x80000000, 0, 0]);
        const witness = await send(witnessPath, 0x0f);
        expect(witness.slice(-2)).toEqual(Uint8Array.of(0x90, 0x00));
        const node = deriveIcarus(ctx().entropy, "m/1852'/1815'/0'/0/0");
        expect(ed25519.verify(witness.slice(0, 64), hash, node.publicKey)).toBe(true);
        const raw = concatBytes(...stages.map((stage) => stage.data));
        expect(ed25519.verify(witness.slice(0, 64), blake2b(raw, { dkLen: 32 }), node.publicKey)).toBe(false);
      } finally {
        resetLedgerVersionPicks();
      }
    }
  });

  it('hashes a Mary 2.2 payment from the short init', async () => {
    const txHash = new Uint8Array(32).fill(0x11);
    const address = concatBytes(Uint8Array.of(0x61), new Uint8Array(28).fill(0x22));
    const init = concatBytes(
      Uint8Array.of(1),
      u32(764824073),
      Uint8Array.of(0x01, 0x01, 0x01, 3),
      u32(1),
      u32(1),
      u32(0),
      u32(0),
      u32(1),
    );
    const basic = concatBytes(Uint8Array.of(1), u32(address.length), address, u64(1_000_000n), u32(0));
    const machine = new CardanoV7Tx('2.2.0');
    await machine.stage(0x01, 0, init, ctx());
    await machine.stage(0x02, 0, concatBytes(txHash, u32(0)), ctx());
    await machine.stage(0x03, 0x30, basic, ctx());
    await machine.stage(0x03, 0x33, new Uint8Array(), ctx());
    await machine.stage(0x04, 0, u64(170_000n), ctx());
    const built = machine.body();
    const input = concatBytes(cborMajor(4, 2n), cborBytes(txHash), cborUnsigned(0n));
    const output = concatBytes(cborMajor(4, 2n), cborBytes(address), cborUnsigned(1_000_000n));
    const body = concatBytes(
      cborMajor(5, 3n),
      cborUnsigned(0n),
      cborMajor(4, 1n),
      input,
      cborUnsigned(1n),
      cborMajor(4, 1n),
      output,
      cborUnsigned(2n),
      cborUnsigned(170_000n),
    );
    expect(Array.from(built ?? new Uint8Array())).toEqual(Array.from(body));
  });

  it('fails closed on CIP-36 auxiliary data and on voting procedures', async () => {
    const { stages } = swap721();
    const cip = new CardanoV7Tx('7.2.1');
    await cip.stage(stages[0]!.p1, stages[0]!.p2, stages[0]!.data, ctx());
    await cip.stage(0x08, 0, Uint8Array.of(1), ctx());
    expect(cip.body()).toBeNull();
    const voters = new Uint8Array(stages[0]!.data);
    voters[voters.length - 8] = 0;
    voters[voters.length - 7] = 0;
    voters[voters.length - 6] = 0;
    voters[voters.length - 5] = 1;
    const machine = new CardanoV7Tx('7.2.1');
    await machine.stage(0x01, 0, voters, ctx());
    expect(machine.body()).toBeNull();
  });
});
