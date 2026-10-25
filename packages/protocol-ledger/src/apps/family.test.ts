import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, catalogVersion, type ConfirmationPort, type LedgerApp } from '@cws/contracts';
import { SW_INS_NOT_SUPPORTED, SW_OK } from '../apdu';
import { deriveEd25519PrivateKey, signEd25519 } from '../crypto';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';

const FOUNDATION = 'test test test test test test test test test test test junk';

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

function encodePath(components: number[]): number[] {
  const out = [components.length];
  for (const component of components) {
    out.push((component >>> 24) & 0xff, (component >>> 16) & 0xff, (component >>> 8) & 0xff, component & 0xff);
  }
  return out;
}

function swOf(payload: Uint8Array): number {
  return (payload[payload.length - 2] << 8) | payload[payload.length - 1];
}

function decodePubAddr(payload: Uint8Array): { pub: Uint8Array; address: string } {
  const pubLen = payload[0];
  const pub = payload.slice(1, 1 + pubLen);
  const addrLen = payload[1 + pubLen];
  const address = Array.from(payload.slice(2 + pubLen, 2 + pubLen + addrLen), (b) => String.fromCharCode(b)).join('');
  return { pub, address };
}

function handler(): LedgerProtocolHandler {
  const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
  return new LedgerProtocolHandler({
    model: nanoX,
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: entropyFromMnemonic(FOUNDATION),
  });
}

type FamilyCase = {
  app: LedgerApp;
  cla: number;
  versionIns: number;
  pubkeyIns: number;
  path: number[];
  address?: (value: string) => boolean;
  rawPubkey?: number;
};

const FAMILIES: FamilyCase[] = [
  {
    app: 'solana',
    cla: 0xe0,
    versionIns: 0x04,
    pubkeyIns: 0x05,
    path: [0x8000002c, 0x800001f5, 0x80000000],
    rawPubkey: 32,
  },
  {
    app: 'xrp',
    cla: 0xe0,
    versionIns: 0x06,
    pubkeyIns: 0x02,
    path: [0x8000002c, 0x80000090, 0x80000000, 0, 0],
    address: (value) => value.startsWith('r'),
  },
  {
    app: 'tron',
    cla: 0xe0,
    versionIns: 0x06,
    pubkeyIns: 0x02,
    path: [0x8000002c, 0x800000c3, 0x80000000, 0, 0],
    address: (value) => value.startsWith('T'),
  },
  {
    app: 'cosmos',
    cla: 0x55,
    versionIns: 0x00,
    pubkeyIns: 0x04,
    path: [0x8000002c, 0x80000076, 0x80000000, 0, 0],
    address: (value) => value.startsWith('cosmos1'),
  },
  {
    app: 'ton',
    cla: 0xe0,
    versionIns: 0x01,
    pubkeyIns: 0x02,
    path: [0x8000002c, 0x8000025f, 0x80000000],
    address: (value) => value.length >= 48,
  },
  {
    app: 'aptos',
    cla: 0x5b,
    versionIns: 0x00,
    pubkeyIns: 0x05,
    path: [0x8000002c, 0x8000027d, 0x80000000, 0x80000000, 0x80000000],
    address: (value) => value.startsWith('0x') && value.length === 66,
  },
  {
    app: 'sui',
    cla: 0x00,
    versionIns: 0x00,
    pubkeyIns: 0x01,
    path: [0x8000002c, 0x80000310, 0x80000000, 0x80000000, 0x80000000],
    address: (value) => value.startsWith('0x') && value.length === 66,
  },
  {
    app: 'cardano',
    cla: 0xd7,
    versionIns: 0x00,
    pubkeyIns: 0x11,
    path: [0x8000073c, 0x80000717, 0x80000000, 0, 0],
    address: (value) => value.startsWith('addr1'),
  },
  {
    app: 'polkadot',
    cla: 0xf9,
    versionIns: 0x00,
    pubkeyIns: 0x01,
    path: [0x8000002c, 0x80000162, 0x80000000, 0x80000000, 0x80000000],
    address: (value) => value.length > 40,
  },
  {
    app: 'near',
    cla: 0x80,
    versionIns: 0x06,
    pubkeyIns: 0x04,
    path: [0x8000002c, 0x8000018d, 0x80000000, 0x80000000, 0x80000001],
    rawPubkey: 32,
  },
];

describe('Ledger family APDU bodies', () => {
  it.each(FAMILIES)('$app GET_VERSION + GET_ADDR 9000 and unknown INS 6D00', async (item) => {
    const device = handler();
    device.setApp(item.app);
    const version = await exchange(device, apdu([item.cla, item.versionIns, 0x00, 0x00, 0x00]));
    expect(swOf(version)).toBe(SW_OK);

    const pathBytes = item.app === 'near' ? encodePath(item.path).slice(1) : encodePath(item.path);
    const pubkey = await exchange(
      device,
      apdu([item.cla, item.pubkeyIns, item.app === 'near' ? 0x00 : 0x01, 0x00, pathBytes.length, ...pathBytes]),
    );
    expect(swOf(pubkey)).toBe(SW_OK);
    if (item.rawPubkey) {
      expect(pubkey.length).toBe(item.rawPubkey + 2);
    } else if (item.address) {
      const decoded = decodePubAddr(pubkey);
      expect(item.address(decoded.address)).toBe(true);
    }

    const unknown = await exchange(device, apdu([item.cla, 0x99, 0x00, 0x00, 0x00]));
    expect(swOf(unknown)).toBe(SW_INS_NOT_SUPPORTED);
  });

  it('Cardano GET_EXT_PUBKEY returns pub||chaincode via CIP-3 Icarus', async () => {
    const device = handler();
    device.setApp('cardano');
    const pathBytes = encodePath([0x8000073c, 0x80000717, 0x80000000, 0, 0]);
    const payload = await exchange(device, apdu([0xd7, 0x10, 0x00, 0x00, pathBytes.length, ...pathBytes]));
    expect(swOf(payload)).toBe(SW_OK);
    expect(payload.length).toBe(64 + 2);
  });

  it('Bitcoin UNTRUSTED_HASH_SIGN signs a 32-byte hash as DER', async () => {
    const device = handler();
    device.setApp('bitcoin');
    const pathBytes = encodePath([0x8000002c, 0x80000000, 0x80000000, 0, 0]);
    const hash = new Array(32).fill(0x11);
    const payload = await exchange(
      device,
      apdu([0xe0, 0x48, 0x00, 0x00, pathBytes.length + hash.length, ...pathBytes, ...hash]),
    );
    expect(swOf(payload)).toBe(SW_OK);
    expect(payload[0]).toBe(0x30);
    expect(payload[payload.length - 3]).toBe(0x01);
  });

  it('Solana GET_APP_CONFIGURATION reports blind signing on', async () => {
    const device = handler();
    device.setApp('solana');
    const payload = await exchange(device, apdu([0xe0, 0x04, 0x00, 0x00, 0x00]));
    expect(swOf(payload)).toBe(SW_OK);
    const [major, minor, patch] = catalogVersion('solana', '1.16.0')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
    expect(Array.from(payload.slice(0, 4))).toEqual([0x01, major & 0xff, minor & 0xff, patch & 0xff]);
  });

  it('Solana chunked SIGN ACKs MORE with empty 9000 then returns 64-byte ed25519', async () => {
    const device = handler();
    device.setApp('solana');
    const pathBytes = encodePath([0x8000002c, 0x800001f5, 0x80000000]);
    const first = [0x11, 0x22, 0x33, 0x44];
    const rest = [0x55, 0x66, 0x77, 0x88];
    const more = await exchange(
      device,
      apdu([0xe0, 0x06, 0x01, 0x02, pathBytes.length + first.length, ...pathBytes, ...first]),
    );
    expect(swOf(more)).toBe(SW_OK);
    expect(more.length).toBe(2);

    const done = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x00, rest.length, ...rest]));
    expect(swOf(done)).toBe(SW_OK);
    expect(done.length).toBe(66);
    const message = Uint8Array.from([...first, ...rest]);
    const expected = signEd25519(
      deriveEd25519PrivateKey(entropyFromMnemonic(FOUNDATION), "m/44'/501'/0'"),
      message,
    );
    expect(Array.from(done.subarray(0, 64))).toEqual(Array.from(expected));
  });

  it('Cardano MORE ACKs empty 9000 then signs on last', async () => {
    const device = handler();
    device.setApp('cardano');
    const pathBytes = encodePath([0x8000073c, 0x80000717, 0x80000000, 0, 0]);
    const first = [0x11, 0x22];
    const rest = [0x33, 0x44];
    const more = await exchange(
      device,
      apdu([0xd7, 0x21, 0x00, 0x02, pathBytes.length + first.length, ...pathBytes, ...first]),
    );
    expect(swOf(more)).toBe(SW_OK);
    expect(more.length).toBe(2);
    const done = await exchange(device, apdu([0xd7, 0x21, 0x01, 0x00, rest.length, ...rest]));
    expect(swOf(done)).toBe(SW_OK);
    expect(done.length).toBeGreaterThan(2);
  });

  it('Bitcoin TX assembly INS 0x44 ACKs a 1-in start then 0x48 signs', async () => {
    const device = handler();
    device.setApp('bitcoin');
    const start = [
      2, 0, 0, 0,
      ...new Array(36).fill(0x11),
      0x10, 0x27, 0, 0, 0, 0, 0, 0,
      0xff, 0xff, 0xff, 0xff,
    ];
    const started = await exchange(device, apdu([0xe0, 0x44, 0x00, 0x02, start.length, ...start]));
    expect(swOf(started)).toBe(SW_OK);
    const outputs = [0xe8, 0x03, 0, 0, 0, 0, 0, 0, 0x16, ...new Array(22).fill(0x00)];
    const finalized = await exchange(device, apdu([0xe0, 0x4a, 0x00, 0x00, outputs.length, ...outputs]));
    expect(swOf(finalized)).toBe(SW_OK);
    const path = [0x05, 0x80, 0x00, 0x00, 0x54, 0x80, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const signed = await exchange(device, apdu([0xe0, 0x48, 0x00, 0x00, path.length, ...path]));
    expect(swOf(signed)).toBe(SW_OK);
    expect(signed.length).toBeGreaterThan(4);
  });
});
