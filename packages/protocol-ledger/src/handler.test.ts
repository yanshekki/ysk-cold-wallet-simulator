import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, describeSigning, overlayDerivationPath, type ConfirmationPort } from '@cws/contracts';
import { encodeResponse, SW_CLA_NOT_SUPPORTED, SW_DENY, SW_OK, SW_WRONG_LENGTH } from './apdu';
import { FUJI_HRP, FUJI_X_CHAIN_ID, avalancheBech32Address } from './apps/avalanche';
import {
  deriveEd25519PrivateKey,
  deriveHdNode,
  ed25519PublicKey,
  ethereumAddressFromPrivateKey,
  derivePrivateKey,
  signEd25519,
} from './crypto';
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

function handlerFor(modelId: string): LedgerProtocolHandler {
  const model = LEDGER_MODELS.find((item) => item.id === modelId)!;
  return new LedgerProtocolHandler({
    model,
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: entropyFromMnemonic(FOUNDATION),
  });
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

  it('answers GET_VERSION with a model-specific targetId', async () => {
    const expected: Record<string, number[]> = {
      'nano-x': [0x33, 0x00, 0x00, 0x04],
      stax: [0x33, 0x20, 0x00, 0x04],
      flex: [0x33, 0x30, 0x00, 0x04],
      gen5: [0x33, 0x40, 0x00, 0x04],
    };
    for (const [id, targetId] of Object.entries(expected)) {
      const payload = await exchange(handlerFor(id), apdu([0xe0, 0x01, 0x00, 0x00, 0x00]));
      expect(Array.from(payload.slice(0, 4)), id).toEqual(targetId);
      expect(payload[payload.length - 2]).toBe(0x90);
      expect(payload[payload.length - 1]).toBe(0x00);
    }
  });

  it('answers GET_VERSION with 4-byte onboarded flags and Nano X optional fields', async () => {
    const payload = await exchange(handlerFor('nano-x'), apdu([0xe0, 0x01, 0x00, 0x00, 0x00]));
    const body = payload.slice(0, payload.length - 2);
    let offset = 4;
    const seLen = body[offset++];
    const se = Array.from(body.slice(offset, offset + seLen), (b) => String.fromCharCode(b)).join('');
    offset += seLen;
    expect(se).toBe('2.7.1');
    const flagsLen = body[offset++];
    const flags = body.slice(offset, offset + flagsLen);
    offset += flagsLen;
    expect(flagsLen).toBe(4);
    expect(flags[0] & 0x04).toBe(0x04);
    expect(flags[0] & 0x08).toBe(0x00);
    expect(flags[0] & 0x80).toBe(0x80);
    expect(flags[3]).toBe(0x0b);
    const mcuLen = body[offset++];
    const mcu = Array.from(body.slice(offset, offset + mcuLen), (b) => String.fromCharCode(b)).join('');
    offset += mcuLen;
    expect(mcu).toBe('2.30');
    const blLen = body[offset++];
    const bl = Array.from(body.slice(offset, offset + blLen), (b) => String.fromCharCode(b)).join('');
    offset += blLen;
    expect(bl).toBe('1.16');
    const hwLen = body[offset++];
    expect(hwLen).toBe(1);
    offset += hwLen;
    const langLen = body[offset++];
    expect(langLen).toBe(1);
    offset += langLen;
    const recoverLen = body[offset++];
    expect(recoverLen).toBe(0);
    offset += recoverLen;
    expect(offset).toBe(body.length);
  });

  it('answers GET_DEVICE_NAME with the BLE local name', async () => {
    const payload = await exchange(handlerFor('nano-x'), apdu([0xe0, 0xd2, 0x00, 0x00, 0x00]));
    const name = Array.from(payload.slice(0, payload.length - 2), (b) =>
      String.fromCharCode(b),
    ).join('');
    expect(name).toBe('Nano X');
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
  });

  it('answers dashboard cleaning E0 50 and LIST_APPS with the installed catalog', async () => {
    const clean = await exchange(handlerFor('nano-x'), apdu([0xe0, 0x50, 0x00, 0x00, 0x00]));
    expect((clean[clean.length - 2] << 8) | clean[clean.length - 1]).toBe(SW_OK);
    expect(clean.length).toBe(2);
    const listed = await exchange(handlerFor('nano-x'), apdu([0xe0, 0xde, 0x00, 0x00, 0x00]));
    expect((listed[listed.length - 2] << 8) | listed[listed.length - 1]).toBe(SW_OK);
    const text = Array.from(listed.slice(0, listed.length - 2), (b) => String.fromCharCode(b)).join('');
    expect(text).toContain('Bitcoin');
    expect(text).toContain('Ethereum');
    expect(text).toContain('Solana');
    expect(listed.length).toBeGreaterThan(40);
  });

  it('opens Solana from the catalog and reports GET_APP_AND_VERSION', async () => {
    const handler = handlerFor('nano-x');
    const openName = Array.from('Solana', (c) => c.charCodeAt(0));
    const opened = await exchange(handler, apdu([0xe0, 0xd8, 0x00, 0x00, openName.length, ...openName]));
    expect((opened[opened.length - 2] << 8) | opened[opened.length - 1]).toBe(SW_OK);
    expect(handler.getApp()).toBe('solana');
    const version = await exchange(handler, apdu([0xb0, 0x01, 0x00, 0x00, 0x00]));
    const versionText = Array.from(version, (b) => String.fromCharCode(b)).join('');
    expect(versionText).toContain('Solana');
    expect(versionText).toContain('1.16.0');
  });

  it('does not open an app when the user rejects', async () => {
    const handler = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((m) => m.id === 'nano-x')!,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    const openName = Array.from('Ethereum', (c) => c.charCodeAt(0));
    const payload = await exchange(
      handler,
      apdu([0xe0, 0xd8, 0x00, 0x00, openName.length, ...openName]),
    );
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_DENY);
    expect(handler.getApp()).toBe('dashboard');
  });

  it('allows Manager after a confirm and denies with SW_DENY', async () => {
    const handler = handlerFor('nano-x');
    const allowed = await exchange(handler, apdu([0xe0, 0x14, 0x00, 0x00, 0x00]));
    expect((allowed[allowed.length - 2] << 8) | allowed[allowed.length - 1]).toBe(SW_OK);
    const version = await exchange(handler, apdu([0xe0, 0x01, 0x00, 0x00, 0x00]));
    const seLen = version[4];
    const flagsLen = version[5 + seLen];
    expect(flagsLen).toBe(4);
    expect(version[6 + seLen] & 0x08).toBe(0x08);

    const denied = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((m) => m.id === 'nano-x')!,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    const payload = await exchange(denied, apdu([0xe0, 0x14, 0x00, 0x00, 0x00]));
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_DENY);
  });

  it('answers GET_VERSION with Stax 1.10.1', async () => {
    const payload = await exchange(handlerFor('stax'), apdu([0xe0, 0x01, 0x00, 0x00, 0x00]));
    const seLen = payload[4];
    const se = Array.from(payload.slice(5, 5 + seLen), (b) => String.fromCharCode(b)).join('');
    expect(se).toBe('1.10.1');
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

  it('opens Bitcoin, exports a confirmed P2PKH key, then quits to BOLOS', async () => {
    const apps: string[] = [];
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
      onAppChange: (app) => {
        apps.push(app);
      },
    });
    const openName = Array.from('Bitcoin', (c) => c.charCodeAt(0));
    await exchange(
      handler,
      apdu([0xe0, 0xd8, 0x00, 0x00, openName.length, ...openName]),
    );
    expect(handler.getApp()).toBe('bitcoin');
    expect(apps).toEqual(['bitcoin']);

    const version = await exchange(handler, apdu([0xb0, 0x01, 0x00, 0x00, 0x00]));
    const versionText = Array.from(version, (b) => String.fromCharCode(b)).join('');
    expect(versionText).toContain('Bitcoin');

    const path = [0x8000002c, 0x80000000, 0x80000000, 0x00000000, 0x00000000];
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
      apdu([0xe0, 0x40, 0x00, 0x00, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    const pubLen = payload[0];
    expect(pubLen).toBe(33);
    const addrLen = payload[1 + pubLen];
    const address = Array.from(
      payload.slice(2 + pubLen, 2 + pubLen + addrLen),
      (b) => String.fromCharCode(b),
    ).join('');
    expect(address.startsWith('1')).toBe(true);
    const chainCode = payload.slice(2 + pubLen + addrLen, payload.length - 2);
    expect(chainCode.length).toBe(32);

    const quit = await exchange(handler, apdu([0xb0, 0xa7, 0x00, 0x00, 0x00]));
    expect((quit[quit.length - 2] << 8) | quit[quit.length - 1]).toBe(SW_OK);
    expect(handler.getApp()).toBe('dashboard');
    expect(apps).toEqual(['bitcoin', 'dashboard']);
  });

  it('exports a native SegWit address for m/84\'/0\'', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('bitcoin');
    const path = [0x80000054, 0x80000000, 0x80000000, 0x00000000, 0x00000000];
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
      apdu([0xe0, 0x40, 0x00, 0x02, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    const pubLen = payload[0];
    const addrLen = payload[1 + pubLen];
    const address = Array.from(
      payload.slice(2 + pubLen, 2 + pubLen + addrLen),
      (b) => String.fromCharCode(b),
    ).join('');
    expect(address.startsWith('bc1')).toBe(true);
  });

  it('does not export a Bitcoin key when the user rejects', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('bitcoin');
    const path = [0x8000002c, 0x80000000, 0x80000000, 0x00000000, 0x00000000];
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
      apdu([0xe0, 0x40, 0x00, 0x00, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_DENY);
  });

  it('answers NEAR GET_VERSION (CLA 0x80 INS 0x06) instead of 0x6e00', async () => {
    const handler = handlerFor('nano-x');
    handler.setApp('near');
    const payload = await exchange(handler, apdu([0x80, 0x06, 0x00, 0x00, 0x00]));
    expect(Array.from(payload)).toEqual([1, 3, 2, 0x90, 0x00]);
  });

  it('returns 0x6e00 for NEAR CLA while another app is open', async () => {
    const handler = handlerFor('nano-x');
    const payload = await exchange(handler, apdu([0x80, 0x06, 0x00, 0x00, 0x00]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_CLA_NOT_SUPPORTED);
  });

  it('exports the NEAR ed25519 public key after a confirm', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('near');
    const path = [0x8000002c, 0x8000018d, 0x80000000, 0x80000000, 0x80000001];
    const pathBytes: number[] = [];
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
      apdu([0x80, 0x04, 0x00, 0x57, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    const expected = ed25519PublicKey(deriveEd25519PrivateKey(entropy, "m/44'/397'/0'/0'/1'"));
    expect(Array.from(payload.slice(0, 32))).toEqual(Array.from(expected));
  });

  it('does not export a NEAR key when the user rejects', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('near');
    const path = [0x8000002c, 0x8000018d, 0x80000000, 0x80000000, 0x80000001];
    const pathBytes: number[] = [];
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
      apdu([0x80, 0x04, 0x00, 0x57, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_DENY);
  });

  it('signs a NEAR payload with ed25519 after the last chunk', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('near');
    const path = [0x8000002c, 0x8000018d, 0x80000000, 0x80000000, 0x80000001];
    const pathBytes: number[] = [];
    for (const component of path) {
      pathBytes.push(
        (component >>> 24) & 0xff,
        (component >>> 16) & 0xff,
        (component >>> 8) & 0xff,
        component & 0xff,
      );
    }
    const message = Uint8Array.from(Array.from('near-tx', (c) => c.charCodeAt(0)));
    const first = await exchange(
      handler,
      apdu([0x80, 0x02, 0x00, 0x00, pathBytes.length, ...pathBytes]),
    );
    expect((first[first.length - 2] << 8) | first[first.length - 1]).toBe(SW_OK);
    const signed = await exchange(
      handler,
      apdu([0x80, 0x02, 0x80, 0x00, message.length, ...message]),
    );
    const sw = (signed[signed.length - 2] << 8) | signed[signed.length - 1];
    expect(sw).toBe(SW_OK);
    const expected = signEd25519(
      deriveEd25519PrivateKey(entropy, "m/44'/397'/0'/0'/1'"),
      message,
    );
    expect(Array.from(signed.slice(0, 64))).toEqual(Array.from(expected));
  });

  it('answers Avalanche GET_VERSION (CLA 0x80 INS 0x00) instead of 0x6e00', async () => {
    const handler = handlerFor('nano-x');
    handler.setApp('avalanche');
    const payload = await exchange(handler, apdu([0x80, 0x00, 0x00, 0x00, 0x00]));
    expect(Array.from(payload.slice(0, 5))).toEqual([0, 1, 4, 23, 0]);
    expect(Array.from(payload.slice(5, 9))).toEqual([0x33, 0x00, 0x00, 0x04]);
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
  });

  it('exports an Avalanche bech32 address after a confirm', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('avalanche');
    const path = [0x8000002c, 0x80002328, 0x80000000, 0x00000000, 0x00000000];
    const pathBytes: number[] = [0, 0, path.length];
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
      apdu([0x80, 0x02, 0x01, 0x00, pathBytes.length, ...pathBytes]),
    );
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    const pub = deriveHdNode(entropy, "m/44'/9000'/0'/0/0").publicKey;
    const pkLen = payload[0];
    expect(pkLen).toBe(33);
    expect(Array.from(payload.slice(1, 1 + pkLen))).toEqual(Array.from(pub));
    const addr = Array.from(
      payload.slice(1 + pkLen + 20, payload.length - 2),
      (b) => String.fromCharCode(b),
    ).join('');
    expect(addr).toBe(avalancheBech32Address(pub));
    expect(addr.startsWith('avax1')).toBe(true);
  });

  it('exports a Fuji X-Chain address and titles the confirm X-Chain', async () => {
    const titles: string[] = [];
    const confirmation: ConfirmationPort = {
      async confirm(request) {
        titles.push(request.title);
        return true;
      },
      async getPassphrase() {
        return undefined;
      },
    };
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation,
      slotId: 'slot',
      entropy,
    });
    handler.setApp('avalanche');
    const path = [0x8000002c, 0x80002328, 0x80000000, 0x00000000, 0x00000000];
    const hrp = Array.from(new TextEncoder().encode(FUJI_HRP));
    const pathBytes: number[] = [hrp.length, ...hrp, FUJI_X_CHAIN_ID.length, ...Array.from(FUJI_X_CHAIN_ID), path.length];
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
      apdu([0x80, 0x02, 0x01, 0x00, pathBytes.length, ...pathBytes]),
    );
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
    expect(titles.some((title) => title.includes('X-Chain'))).toBe(true);
    const pub = deriveHdNode(entropy, "m/44'/9000'/0'/0/0").publicKey;
    const pkLen = payload[0];
    const addr = Array.from(
      payload.slice(1 + pkLen + 20, payload.length - 2),
      (b) => String.fromCharCode(b),
    ).join('');
    expect(addr).toBe(avalancheBech32Address(pub, FUJI_HRP));
    expect(addr.startsWith('fuji1')).toBe(true);
  });

  it('answers ETH GET_ADDRESS while the Avalanche app is open', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('avalanche');
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

  it('does not fake success for an empty SIGN_TX', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const payload = await exchange(handler, apdu([0xe0, 0x04, 0x00, 0x00, 0x00]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_WRONG_LENGTH);
  });

  it('signs a complete Ethereum RLP payload', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const pathBytes = [0x05, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x00, 0x3c, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0];
    const payload = await exchange(handler, apdu([0xe0, 0x04, 0x00, 0x00, pathBytes.length, ...pathBytes]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload.length).toBe(1 + 64 + 2);
    expect(payload[0] === 27 || payload[0] === 28).toBe(true);
  });

  it('signs a legacy Ethereum transaction as v||r||s with v in {27,28}', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const to = new Array(20).fill(0x11);
    const inner = [0x80, 0x01, 0x82, 0x52, 0x08, 0x94, ...to, 0x80, 0x80, 0x01, 0x80, 0x80];
    const legacy = [0xc0 + inner.length, ...inner];
    const pathBytes = [0x05, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x00, 0x3c, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, ...legacy];
    const payload = await exchange(handler, apdu([0xe0, 0x04, 0x00, 0x00, pathBytes.length, ...pathBytes]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload.length).toBe(1 + 64 + 2);
    expect(payload[0] === 27 || payload[0] === 28).toBe(true);
  });

  it('signs hashed EIP-712 as v||r||s', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const domain = new Array(32).fill(0x11);
    const message = new Array(32).fill(0x22);
    const pathBytes = [
      0x05, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x00, 0x3c, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, ...domain, ...message,
    ];
    const payload = await exchange(handler, apdu([0xe0, 0x0c, 0x00, 0x00, pathBytes.length, ...pathBytes]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload.length).toBe(1 + 64 + 2);
    expect(payload[0] === 27 || payload[0] === 28).toBe(true);
  });

  it('signs an EIP-1559 payload as v||r||s with v in {0,1}', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const to = new Array(20).fill(0x22);
    const inner = [0x01, 0x80, 0x01, 0x01, 0x82, 0x52, 0x08, 0x94, ...to, 0x80, 0x80, 0xc0];
    const typed = [0x02, 0xc0 + inner.length, ...inner];
    const pathBytes = [0x05, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x00, 0x3c, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, ...typed];
    const payload = await exchange(handler, apdu([0xe0, 0x04, 0x00, 0x00, pathBytes.length, ...pathBytes]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload.length).toBe(1 + 64 + 2);
    expect(payload[0] === 0 || payload[0] === 1).toBe(true);
  });

  it('completes a 0x03 envelope and still marks decodeFailed', async () => {
    const seen: string[] = [];
    const confirmation: ConfirmationPort = {
      async confirm(request) {
        seen.push(request.path);
        expect(request.detail?.decodeFailed ?? describeSigning(request).decodeFailed).toBe(true);
        return true;
      },
      async getPassphrase() {
        return undefined;
      },
    };
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation,
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const typed = [0x03, 0xc0];
    const pathBytes = [
      0x05, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x00, 0x3c, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, ...typed,
    ];
    const payload = await exchange(handler, apdu([0xe0, 0x04, 0x00, 0x00, pathBytes.length, ...pathBytes]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload.length).toBe(1 + 64 + 2);
    expect(seen).toEqual([PATH]);
  });

  it('uses a session path overlay when the ETH family matches', async () => {
    const overlay = { id: 'eth' as const, path: "m/44'/60'/1'/0/0" };
    const confirmation: ConfirmationPort = {
      async confirm(request) {
        expect(request.path).toBe(overlay.path);
        return true;
      },
      async getPassphrase() {
        return undefined;
      },
      resolvePath(apduPath, chains) {
        return overlayDerivationPath(apduPath, chains, overlay);
      },
    };
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation,
      slotId: 'slot',
      entropy,
    });
    handler.setApp('ethereum');
    const pathBytes = [0x05, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x00, 0x3c, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const payload = await exchange(handler, apdu([0xe0, 0x02, 0x01, 0x00, pathBytes.length, ...pathBytes]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
  });

  it('exports a Solana pubkey over the Solana family APDU', async () => {
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    handler.setApp('solana');
    const pathBytes = [0x02, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x01, 0xf5];
    const payload = await exchange(handler, apdu([0xe0, 0x05, 0x01, 0x00, pathBytes.length, ...pathBytes]));
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload.length).toBe(32 + 2);
  });
});

describe('encodeResponse', () => {
  it('appends status words', () => {
    const encoded = encodeResponse(Uint8Array.of(0x01), SW_OK);
    expect(Array.from(encoded)).toEqual([0x01, 0x90, 0x00]);
  });
});
