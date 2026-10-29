import { keccak_256 } from '@noble/hashes/sha3';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, type ConfirmationPort, type SigningRequest } from '@cws/contracts';
import { parseApdu, SW_INS_NOT_SUPPORTED, SW_OK, SW_WRONG_LENGTH, SW_WRONG_P1P2 } from '../apdu';
import { concatBytes } from '../bytes';
import { derivePrivateKey, signSecp256k1Recoverable } from '../crypto';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { handleEthereumApdu, MAX_PERSONAL_SIGN_BYTES, type EthSession } from './ethereum';

const FOUNDATION = 'test test test test test test test test test test test junk';
const ETH_PATH = [0x8000002c, 0x8000003c, 0x80000000, 0, 0];

function entropyFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

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

function encodePath(components: number[]): Uint8Array {
  const out = new Uint8Array(1 + components.length * 4);
  out[0] = components.length;
  for (let i = 0; i < components.length; i++) {
    const value = components[i] >>> 0;
    const offset = 1 + i * 4;
    out[offset] = (value >>> 24) & 0xff;
    out[offset + 1] = (value >>> 16) & 0xff;
    out[offset + 2] = (value >>> 8) & 0xff;
    out[offset + 3] = value & 0xff;
  }
  return out;
}

function encodeApdu(cla: number, ins: number, p1: number, p2: number, data: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(cla, ins, p1, p2, data.length), data);
}

function statusWord(payload: Uint8Array): number {
  return (payload[payload.length - 2] << 8) | payload[payload.length - 1];
}

function ethCtx(session: EthSession = {}) {
  return {
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: entropyFromMnemonic(FOUNDATION),
    session,
  };
}

async function exchange(handler: LedgerProtocolHandler, apdu: Uint8Array): Promise<Uint8Array | null> {
  const incoming = splitFramedPackets(framePayload(TAG_APDU, apdu, DEFAULT_MTU), DEFAULT_MTU);
  let outgoing: Uint8Array | null = null;
  for (const packet of incoming) {
    outgoing = await handler.handleWrite(packet);
  }
  if (!outgoing) {
    return null;
  }
  const assembler = new BleReassembler();
  let assembled = null;
  for (const packet of splitFramedPackets(outgoing, DEFAULT_MTU)) {
    assembled = assembler.push(packet);
  }
  return assembled?.payload ?? null;
}

describe('ETH adversarial bounds', () => {
  it('rejects personal_sign when the declared length exceeds the cap', async () => {
    const data = concatBytes(encodePath(ETH_PATH), Uint8Array.of(0xff, 0xff, 0xff, 0xff));
    const apdu = parseApdu(encodeApdu(0xe0, 0x08, 0x00, 0x00, data));
    const reply = await handleEthereumApdu(apdu, ethCtx());
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_WRONG_LENGTH);
    expect(MAX_PERSONAL_SIGN_BYTES).toBe(16_384);
  });

  it('rejects GET_ADDRESS with an empty BIP32 path', async () => {
    const apdu = parseApdu(encodeApdu(0xe0, 0x02, 0x00, 0x00, Uint8Array.of(0x00)));
    const reply = await handleEthereumApdu(apdu, ethCtx());
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_WRONG_P1P2);
  });

  it('ACKs an incomplete personal_sign chunk, then signs once the message is whole', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    let confirms = 0;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm() {
          confirms += 1;
          return true;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    handler.setApp('ethereum');
    const message = Uint8Array.from([0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a]);
    const first = concatBytes(encodePath(ETH_PATH), Uint8Array.of(0x00, 0x00, 0x00, message.length), message.subarray(0, 1));
    const ack = await exchange(handler, encodeApdu(0xe0, 0x08, 0x00, 0x00, first));
    expect(ack).not.toBeNull();
    expect(statusWord(ack!)).toBe(SW_OK);
    expect(ack!.length).toBe(2);
    expect(confirms).toBe(0);
    const signed = await exchange(handler, encodeApdu(0xe0, 0x08, 0x80, 0x00, message.subarray(1)));
    expect(signed).not.toBeNull();
    expect(statusWord(signed!)).toBe(SW_OK);
    expect(signed!.length).toBe(67);
    expect(confirms).toBe(1);
  });

  it('clears pendingPersonal on resetLink', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    handler.setApp('ethereum');
    const first = concatBytes(encodePath(ETH_PATH), Uint8Array.of(0x00, 0x00, 0x00, 0x0a), Uint8Array.of(0x61));
    const ack = await exchange(handler, encodeApdu(0xe0, 0x08, 0x00, 0x00, first));
    expect(ack).not.toBeNull();
    expect(statusWord(ack!)).toBe(SW_OK);
    expect(ack!.length).toBe(2);
    handler.resetLink();
    const cont = await exchange(handler, encodeApdu(0xe0, 0x08, 0x80, 0x00, Uint8Array.of(0x62)));
    expect(cont).not.toBeNull();
    expect(statusWord(cont!)).toBe(SW_WRONG_LENGTH);
  });

  it('returns 6D00 when APDU Lc exceeds the buffer', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    const reply = await exchange(handler, Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x05, 0xaa));
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_INS_NOT_SUPPORTED);
  });

  it('refuses an undecodable SIGN_TX instead of signing bytes the sheet cannot explain', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    let confirms = 0;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm() {
          confirms += 1;
          return true;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    handler.setApp('ethereum');
    const garbage = concatBytes(encodePath(ETH_PATH), Uint8Array.of(0x03, 0xff, 0x00, 0x01));
    const reply = await exchange(handler, encodeApdu(0xe0, 0x04, 0x00, 0x00, garbage));
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_INS_NOT_SUPPORTED);
    expect(reply!.length).toBe(2);
    expect(confirms).toBe(0);
  });

  it('still answers GET_VERSION after a malformed APDU', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    await exchange(handler, Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x05, 0xaa));
    const version = await exchange(handler, encodeApdu(0xe0, 0x01, 0x00, 0x00, new Uint8Array()));
    expect(version).not.toBeNull();
    expect(statusWord(version!)).toBe(SW_OK);
  });

  it('does not sign a raw 32-byte digest presented as EIP-7702', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    let confirms = 0;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm() {
          confirms += 1;
          return true;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    handler.setApp('ethereum');
    const data = concatBytes(encodePath(ETH_PATH), new Uint8Array(32).fill(0xab));
    const reply = await exchange(handler, encodeApdu(0xe0, 0x34, 0x01, 0x00, data));
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_WRONG_LENGTH);
    expect(confirms).toBe(0);
  });

  it('shows delegate, chain id, and nonce before an EIP-7702 authorization signature', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const seen: SigningRequest[] = [];
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm(request) {
          seen.push(request);
          return true;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    handler.setApp('ethereum');
    const delegate = new Uint8Array(20).fill(0x11);
    const body = concatBytes(
      tlv(0x00, Uint8Array.of(1)),
      tlv(0x01, delegate),
      tlv(0x02, u64(1n)),
      tlv(0x03, u64(0n)),
    );
    const data = concatBytes(encodePath(ETH_PATH), Uint8Array.of((body.length >> 8) & 0xff, body.length & 0xff), body);
    const reply = await exchange(handler, encodeApdu(0xe0, 0x34, 0x01, 0x00, data));
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_OK);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.detail?.headline).toBe('EIP-7702 authorization');
    expect(seen[0]?.detail?.fields).toEqual(
      expect.arrayContaining([
        { label: 'TO', value: `0x${'11'.repeat(20)}`, mono: true },
        { label: 'CHAIN ID', value: '1' },
        { label: 'NONCE', value: '0' },
      ]),
    );
    const listBody = concatBytes(rlpInt(1n), rlpBytes(delegate), rlpInt(0n));
    const digest = keccak_256(concatBytes(Uint8Array.of(0x05), Uint8Array.of(0xc0 + listBody.length), listBody));
    const expected = signSecp256k1Recoverable(
      derivePrivateKey(entropyFromMnemonic(FOUNDATION), "m/44'/60'/0'/0/0"),
      digest,
    );
    expect(Array.from(reply!.subarray(0, 65))).toEqual(
      Array.from(concatBytes(Uint8Array.of(expected[64] ?? 0), expected.subarray(0, 64))),
    );
  });
});

function tlv(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag, value.length), value);
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let next = value;
  for (let index = 7; index >= 0; index -= 1) {
    out[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return out;
}

function rlpBytes(bytes: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(0x80 + bytes.length), bytes);
}

function rlpInt(value: bigint): Uint8Array {
  if (value === 0n) {
    return Uint8Array.of(0x80);
  }
  const raw: number[] = [];
  let next = value;
  while (next > 0n) {
    raw.unshift(Number(next & 0xffn));
    next >>= 8n;
  }
  if (raw.length === 1 && raw[0]! < 0x80) {
    return Uint8Array.of(raw[0]!);
  }
  return concatBytes(Uint8Array.of(0x80 + raw.length), Uint8Array.from(raw));
}
