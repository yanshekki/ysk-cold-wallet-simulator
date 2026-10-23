import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, type ConfirmationPort } from '@cws/contracts';
import { encodeResponse, SW_DENY, SW_INS_NOT_SUPPORTED, SW_OK } from './apdu';
import { ethereumAddressFromPrivateKey, derivePrivateKey } from './crypto';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU, TAG_MTU } from './framing';
import { LedgerProtocolHandler } from './handler';

const FOUNDATION =
  'test test test test test test test test test test test junk';
const PATH = "m/44'/60'/0'/0/0";
const EXPECTED_ADDRESS = 'f39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function entropyFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

function autoConfirm(accept = true): ConfirmationPort {
  return {
    async confirm() {
      return accept;
    },
    async getPassphrase() {
      return undefined;
    },
  };
}

function apdu(bytes: number[]): Uint8Array {
  return framePayload(TAG_APDU, Uint8Array.from(bytes), DEFAULT_MTU);
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

describe('LedgerProtocolHandler', () => {
  const nanoX = LEDGER_MODELS.find((m) => m.id === 'nano-x')!;
  const entropy = entropyFromMnemonic(FOUNDATION);

  it('answers GET_MTU with the negotiated size', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const framed = await handler.handleWrite(
      framePayload(TAG_MTU, new Uint8Array(), DEFAULT_MTU),
    );
    const payload = new BleReassembler().push(framed!)!.payload;
    expect(payload[0]).toBe(DEFAULT_MTU);
  });

  it('returns BOLOS app name on dashboard B0 01', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const payload = await exchange(handler, apdu([0xb0, 0x01, 0x00, 0x00, 0x00]));
    const text = Array.from(payload, (b) => String.fromCharCode(b)).join('');
    expect(text).toContain('BOLOS');
    expect(payload[payload.length - 2]).toBe(0x90);
    expect(payload[payload.length - 1]).toBe(0x00);
  });

  it('returns 0x6D00 for unknown INS', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const payload = await exchange(handler, apdu([0xe0, 0xff, 0x00, 0x00, 0x00]));
    expect(payload[0]).toBe(0x6d);
    expect(payload[1]).toBe(0x00);
  });

  it('opens Ethereum and returns the known GET_ADDRESS', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const openName = Array.from('Ethereum', (c) => c.charCodeAt(0));
    await exchange(
      handler,
      apdu([0xe0, 0xd8, 0x00, 0x00, openName.length, ...openName]),
    );
    expect(handler.getApp()).toBe('ethereum');

    const path = [0x8000002c, 0x8000003c, 0x80000000, 0x00000000, 0x00000000];
    const pathBytes: number[] = [path.length];
    for (const component of path) {
      pathBytes.push(
        (component >>> 24) & 0xff,
        (component >>> 16) & 0xff,
        (component >>> 8) & 0xff,
        component & 0xff,
      );
    }
    const payload = await exchange(
      handler,
      apdu([0xe0, 0x02, 0x01, 0x00, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    const pubLen = payload[0];
    const addrLen = payload[1 + pubLen];
    const address = Array.from(
      payload.slice(2 + pubLen, 2 + pubLen + addrLen),
      (b) => String.fromCharCode(b),
    ).join('');
    expect(address.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });

  it('does not sign when the user rejects', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const path = [0x8000002c, 0x8000003c, 0x80000000, 0x00000000, 0x00000000];
    const pathBytes: number[] = [path.length];
    for (const component of path) {
      pathBytes.push(
        (component >>> 24) & 0xff,
        (component >>> 16) & 0xff,
        (component >>> 8) & 0xff,
        component & 0xff,
      );
    }
    const payload = await exchange(
      handler,
      apdu([0xe0, 0x02, 0x01, 0x00, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_DENY);
  });

  it('signs a personal message with a real secp256k1 signature', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const message = Uint8Array.from(Array.from('hello', (c) => c.charCodeAt(0)));
    const path = [0x8000002c, 0x8000003c, 0x80000000, 0x00000000, 0x00000000];
    const data: number[] = [path.length];
    for (const component of path) {
      data.push(
        (component >>> 24) & 0xff,
        (component >>> 16) & 0xff,
        (component >>> 8) & 0xff,
        component & 0xff,
      );
    }
    data.push(0x00, 0x00, 0x00, message.length, ...message);
    const payload = await exchange(
      handler,
      apdu([0xe0, 0x08, 0x00, 0x00, data.length, ...data]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload.length).toBe(67);
    expect(payload[0] === 27 || payload[0] === 28).toBe(true);
  });

  it('derives the foundry default address', () => {
    const key = derivePrivateKey(entropy, PATH);
    expect(ethereumAddressFromPrivateKey(key).toLowerCase()).toBe(
      EXPECTED_ADDRESS.toLowerCase(),
    );
  });

  it('does not fake success for SIGN_TX', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const payload = await exchange(handler, apdu([0xe0, 0x04, 0x00, 0x00, 0x00]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_INS_NOT_SUPPORTED);
  });
});

describe('encodeResponse', () => {
  it('appends status words', () => {
    const encoded = encodeResponse(Uint8Array.of(0x01), SW_OK);
    expect(Array.from(encoded)).toEqual([0x01, 0x90, 0x00]);
  });
});
