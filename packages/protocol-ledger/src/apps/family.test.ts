import { sha256 } from '@noble/hashes/sha2';
import { base58 } from '@scure/base';
import { mnemonicToEntropy, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, catalogVersion, type ConfirmationPort, type LedgerApp, type SigningRequest } from '@cws/contracts';
import { buildP2wpkhPsbt as buildQrPsbt, parsePsbt } from '@cws/protocol-qr';
import { SW_DENY, SW_INS_NOT_SUPPORTED, SW_INTERRUPTED, SW_OK } from '../apdu';
import {
  CLA_FRAMEWORK,
  ClientCommandInterpreter,
  defaultWalletPolicy,
  encodeSignPsbtCommand,
  INS_CONTINUE,
  prepareSignPsbtInterpreter,
  psbtMapsToByteMaps,
  serializeWalletPolicy,
  walletHmac,
  walletIdOf,
} from '../index';
import { deriveEd25519PrivateKey, ed25519PublicKey, signEd25519 } from '../crypto';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { bytesToHex, concatBytes } from '../bytes';
import { suiAddress, suiAddressBytes } from './addresses';
import {
  previewCosmosSignDoc,
  previewSolanaMessage,
  previewStellarEnvelope,
  previewTezosOperation,
  previewTronTransfer,
} from './generic';

const FOUNDATION = 'test test test test test test test test test test test junk';

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
    versionIns: 0x03,
    pubkeyIns: 0x05,
    path: [0x8000002c, 0x8000025f, 0x80000000],
    rawPubkey: 32,
  },
  {
    app: 'stellar',
    cla: 0xe0,
    versionIns: 0x06,
    pubkeyIns: 0x02,
    path: [0x8000002c, 0x80000094, 0x80000000],
    rawPubkey: 32,
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

  it('Cardano GET_VERSION is major||minor||patch||flags so BLE connect passes the host length check', async () => {
    const device = handler();
    expect(device.getApp()).toBe('dashboard');
    const payload = await exchange(device, apdu([0xd7, 0x00, 0x00, 0x00, 0x00]));
    expect(device.getApp()).toBe('cardano');
    expect(swOf(payload)).toBe(SW_OK);
    const body = payload.subarray(0, payload.length - 2);
    // @cardano-foundation/ledgerjs-hw-app-cardano Ada._send asserts this.
    const expectedResponseLength = 4;
    if (body.length !== expectedResponseLength) {
      throw new Error(
        `Assertion failed: unexpected response length: ${body.length} instead of ${expectedResponseLength}`,
      );
    }
    const [major, minor, patch] = catalogVersion('cardano', '7.2.1')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
    expect(Array.from(body)).toEqual([major, minor, patch, 0x00]);

    const account = encodePath([0x8000073c, 0x80000717, 0x80000000]);
    const xpub = await exchange(device, apdu([0xd7, 0x10, 0x00, 0x00, account.length, ...account]));
    expect(swOf(xpub)).toBe(SW_OK);
    const key = xpub.subarray(0, xpub.length - 2);
    if (key.length !== 64) {
      throw new Error(`Assertion failed: unexpected response length: ${key.length} instead of 64`);
    }
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

  it('Bitcoin UNTRUSTED_HASH_SIGN reject returns 6985 and shows the host hash', async () => {
    const seen: SigningRequest[] = [];
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        confirm: async (request) => {
          seen.push(request);
          return false;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    device.setApp('bitcoin');
    const pathBytes = encodePath([0x8000002c, 0x80000000, 0x80000000, 0, 0]);
    const hash = new Array(32).fill(0x11);
    const payload = await exchange(
      device,
      apdu([0xe0, 0x48, 0x00, 0x00, pathBytes.length + hash.length, ...pathBytes, ...hash]),
    );
    expect(swOf(payload)).toBe(SW_DENY);
    expect(payload.length).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.title).toBe('Sign host-supplied hash');
    expect(seen[0]?.detail?.warning).toMatch(/host supplied this hash/i);
    expect(seen[0]?.detail?.warning).toMatch(/not a decoded transaction/i);
    expect(seen[0]?.detail?.fields.find((field) => field.label === 'HASH')?.value).toBe(`0x${'11'.repeat(32)}`);
    expect(seen[0]?.detail?.fields.find((field) => field.label === 'CHAIN')?.value).toBe('Bitcoin');
  });

  it('Solana GET_APP_CONFIGURATION reports blind signing on', async () => {
    const device = handler();
    device.setApp('solana');
    const payload = await exchange(device, apdu([0xe0, 0x04, 0x00, 0x00, 0x00]));
    expect(swOf(payload)).toBe(SW_OK);
    const [major, minor, patch] = catalogVersion('solana', '1.16.0')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
    expect(Array.from(payload.slice(0, 5))).toEqual([
      0x01,
      0x00,
      major & 0xff,
      minor & 0xff,
      patch & 0xff,
    ]);
  });

  it('Solana GET_PUBKEY P1=1 confirms and P1=0 stays silent', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    let confirms = 0;
    const device = new LedgerProtocolHandler({
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
    device.setApp('solana');
    const pathBytes = encodePath([0x8000002c, 0x800001f5, 0x80000000]);
    const silent = await exchange(device, apdu([0xe0, 0x05, 0x00, 0x00, pathBytes.length, ...pathBytes]));
    expect(swOf(silent)).toBe(SW_OK);
    expect(confirms).toBe(0);
    expect(silent.length).toBe(34);
    const shown = await exchange(device, apdu([0xe0, 0x05, 0x01, 0x00, pathBytes.length, ...pathBytes]));
    expect(swOf(shown)).toBe(SW_OK);
    expect(confirms).toBe(1);
    expect(Array.from(shown.subarray(0, 32))).toEqual(Array.from(silent.subarray(0, 32)));
  });

  it('Solana system transfer review names the recipient and lamports', async () => {
    const from = new Uint8Array(32);
    from[0] = 1;
    const to = new Uint8Array(32);
    to[0] = 2;
    const message = concatBytes(
      Uint8Array.of(1, 0, 1, 3),
      from,
      to,
      new Uint8Array(32),
      new Uint8Array(32),
      Uint8Array.of(1, 2, 2, 0, 1, 12, 2, 0, 0, 0, 0x00, 0xca, 0x9a, 0x3b, 0, 0, 0, 0),
    );
    const path = [0x8000002c, 0x800001f5, 0x80000000];
    const pathBytes = encodePath(path);
    const data = [0x01, ...pathBytes, ...message];
    const seen: SigningRequest[] = [];
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm(next) {
          seen.push(next);
          return false;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    device.setApp('solana');
    const payload = await exchange(device, apdu([0xe0, 0x06, 0x00, 0x00, data.length, ...data]));
    expect(swOf(payload)).toBe(SW_DENY);
    const fields = seen[0]?.detail?.fields ?? [];
    expect(fields.find((field) => field.label === 'TO')?.value).toBe(base58.encode(to));
    expect(fields.find((field) => field.label === 'AMOUNT')?.value).toBe('1 SOL (1000000000 lamports)');
    expect(fields.find((field) => field.label === 'PATH')?.value).toBe("m/44'/501'/0'");
  });

  it('Solana chunked SIGN ACKs MORE with empty 9000 then returns 64-byte ed25519', async () => {
    const device = handler();
    device.setApp('solana');
    const pathBytes = encodePath([0x8000002c, 0x800001f5, 0x80000000]);
    const first = [0x11, 0x22, 0x33, 0x44];
    const rest = [0x55, 0x66, 0x77, 0x88];
    const head = [0x01, ...pathBytes, ...first];
    const more = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x02, head.length, ...head]));
    expect(swOf(more)).toBe(SW_OK);
    expect(more.length).toBe(2);

    const done = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x01, rest.length, ...rest]));
    expect(swOf(done)).toBe(SW_OK);
    expect(done.length).toBe(66);
    const message = Uint8Array.from([...first, ...rest]);
    const expected = signEd25519(
      deriveEd25519PrivateKey(entropyFromMnemonic(FOUNDATION), "m/44'/501'/0'"),
      message,
    );
    expect(Array.from(done.subarray(0, 64))).toEqual(Array.from(expected));
  });

  it('Cardano v8 INIT and CHUNK ACK empty 9000', async () => {
    const device = handler();
    device.setApp('cardano');
    const init = await exchange(device, apdu([0xd7, 0x21, 0x10, 0x00, 0x04, 0, 0, 0, 1]));
    expect(swOf(init)).toBe(SW_OK);
    expect(init.length).toBe(2);
    const chunk = await exchange(device, apdu([0xd7, 0x21, 0x11, 0x00, 0x02, 0x11, 0x22]));
    expect(swOf(chunk)).toBe(SW_OK);
    expect(chunk.length).toBe(2);
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

  it('Bitcoin GET_WALLET_PUBLIC_KEY p2=0x04 returns a bc1p address', async () => {
    const device = handler();
    device.setApp('bitcoin');
    const pathBytes = encodePath([0x80000056, 0x80000000, 0x80000000, 0, 0]);
    const payload = await exchange(device, apdu([0xe0, 0x40, 0x00, 0x04, pathBytes.length, ...pathBytes]));
    expect(swOf(payload)).toBe(SW_OK);
    const decoded = decodePubAddr(payload);
    expect(decoded.address.startsWith('bc1p')).toBe(true);
  });

  it('Bitcoin Client CLA 0xE1 returns fingerprint and signs a raw PSBT', async () => {
    const device = handler();
    device.setApp('bitcoin');
    const xfp = await exchange(device, apdu([0xe1, 0x05, 0x00, 0x00, 0x00]));
    expect(swOf(xfp)).toBe(SW_OK);
    expect(xfp.length).toBe(6);

    const seed = mnemonicToSeedSync(FOUNDATION);
    const master = HDKey.fromMasterSeed(seed);
    const node = master.derive("m/84'/0'/0'/0/0");
    const psbt = buildQrPsbt({
      amount: 10000n,
      pubkey: node.publicKey!,
      fingerprint: master.fingerprint,
      pathIndexes: [0x80000054, 0x80000000, 0x80000000, 0, 0],
      outputScript: concatBytes(Uint8Array.of(0x00, 0x14), new Uint8Array(20).fill(0x33)),
      outputAmount: 8000n,
    });
    expect(psbt.length).toBeLessThan(256);
    const signed = await exchange(device, apdu([0xe1, 0x04, 0x00, 0x00, psbt.length, ...psbt]));
    expect(swOf(signed)).toBe(SW_OK);
    expect(signed.length).toBeGreaterThan(7);
  });

  it('Ethereum INS 0x1C JSON then 0x0C P2=01 signs EIP-712', async () => {
    const device = handler();
    device.setApp('ethereum');
    const json = new TextEncoder().encode(
      '{"types":{"EIP712Domain":[{"name":"name","type":"string"}],"Mail":[{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Ether Mail"},"message":{"contents":"hi"}}',
    );
    const stored = await exchange(device, apdu([0xe0, 0x1c, 0x00, 0x00, json.length, ...json]));
    expect(swOf(stored)).toBe(SW_OK);
    const pathBytes = encodePath([0x8000002c, 0x8000003c, 0x80000000, 0, 0]);
    const payload = await exchange(device, apdu([0xe0, 0x0c, 0x00, 0x01, pathBytes.length, ...pathBytes]));
    expect(swOf(payload)).toBe(SW_OK);
    expect(payload.length).toBe(67);
  });

  it('Ethereum INS 0x1A/0x1C stream then 0x0C P2=01 signs Mail', async () => {
    const device = handler();
    device.setApp('ethereum');
    const send = async (ins: number, p2: number, data: number[]) => {
      const payload = await exchange(device, apdu([0xe0, ins, 0x00, p2, data.length, ...data]));
      expect(swOf(payload)).toBe(SW_OK);
      return payload;
    };
    const name = (text: string) => Array.from(new TextEncoder().encode(text));
    await send(0x1a, 0x00, name('EIP712Domain'));
    await send(0x1a, 0xff, [0x05, 4, ...name('name')]);
    await send(0x1a, 0x00, name('Mail'));
    await send(0x1a, 0xff, [0x05, 8, ...name('contents')]);
    await send(0x1c, 0x00, name('EIP712Domain'));
    const domain = name('Ether Mail');
    await send(0x1c, 0xff, [0x00, domain.length, ...domain]);
    await send(0x1c, 0x00, name('Mail'));
    const contents = name('hi');
    await send(0x1c, 0xff, [0x00, contents.length, ...contents]);
    const pathBytes = encodePath([0x8000002c, 0x8000003c, 0x80000000, 0, 0]);
    const payload = await exchange(device, apdu([0xe0, 0x0c, 0x00, 0x01, pathBytes.length, ...pathBytes]));
    expect(swOf(payload)).toBe(SW_OK);
    expect(payload.length).toBe(67);
  });

  it('family previews decode SOL v0, Cosmos protobuf, TRX transfer, XLM envelope, XTZ tag', () => {
    const payer = new Uint8Array(32);
    payer[0] = 1;
    const blockhash = new Uint8Array(32);
    blockhash[31] = 2;
    const solV0 = concatBytes(
      Uint8Array.of(0x80, 1, 0, 0, 1),
      payer,
      blockhash,
      Uint8Array.of(0, 1),
      new Uint8Array(32),
      Uint8Array.of(0, 0),
    );
    expect(previewSolanaMessage(solV0)).toMatch(/v0 · fee payer /);
    expect(previewSolanaMessage(solV0)).toMatch(/1 lookup table/);
    expect(previewSolanaMessage(solV0)).not.toMatch(/lamports/);

    const from = new Uint8Array(32);
    from[0] = 1;
    const recipient = new Uint8Array(32);
    recipient[0] = 2;
    const transfer = concatBytes(
      Uint8Array.of(1, 0, 1, 3),
      from,
      recipient,
      new Uint8Array(32),
      new Uint8Array(32),
      Uint8Array.of(1, 2, 2, 0, 1, 12, 2, 0, 0, 0, 0x00, 0xca, 0x9a, 0x3b, 0, 0, 0, 0),
    );
    const preview = previewSolanaMessage(transfer);
    expect(preview).toContain(`to ${base58.encode(recipient)}`);
    expect(preview).toContain('1 SOL (1000000000 lamports)');
    expect(preview).toContain('1 instruction');

    const cosmos = Uint8Array.from([0x1a, 11, ...new TextEncoder().encode('cosmoshub-4'), 0x20, 0x01]);
    expect(previewCosmosSignDoc(cosmos)).toBe('chain cosmoshub-4 · account 1');

    const to = Uint8Array.of(0x41, ...new Array(20).fill(0x11));
    const trx = Uint8Array.from([0x12, 21, ...to, 0x18, 0xe8, 0x07]);
    expect(previewTronTransfer(trx)).toMatch(/Transfer 1000 to /);

    expect(previewStellarEnvelope(Uint8Array.of(0, 0, 0, 2, 0xaa))).toBe('Stellar tx · 5 bytes');
    expect(previewTezosOperation(Uint8Array.of(0x6c, ...new Array(21).fill(0x22)))).toMatch(/^Tezos transaction · /);
  });

  it('Ethereum GET_APP_CONFIGURATION sets arbitrary-data flag and GET_CHALLENGE returns 32 bytes', async () => {
    const device = handler();
    device.setApp('ethereum');
    const config = await exchange(device, apdu([0xe0, 0x06, 0x00, 0x00, 0x00]));
    expect(swOf(config)).toBe(SW_OK);
    expect(config[0]).toBe(0x01);
    const challenge = await exchange(device, apdu([0xe0, 0x20, 0x00, 0x00, 0x00]));
    expect(swOf(challenge)).toBe(SW_OK);
    expect(challenge.length).toBe(34);
  });

  it('Ethereum INS 0x0A stores ERC-20 metadata', async () => {
    const device = handler();
    device.setApp('ethereum');
    const ticker = [0x55, 0x53, 0x44, 0x54];
    const info = [ticker.length, ...ticker, ...new Array(20).fill(0x11), 0, 0, 0, 6, 0, 0, 0, 1];
    const payload = await exchange(device, apdu([0xe0, 0x0a, 0x00, 0x00, info.length, ...info]));
    expect(swOf(payload)).toBe(SW_OK);
  });

  async function continueUntilDone(
    device: LedgerProtocolHandler,
    interpreter: ClientCommandInterpreter,
    first: Uint8Array,
  ): Promise<Uint8Array> {
    let payload = await exchange(device, first);
    let guard = 0;
    while (swOf(payload) === SW_INTERRUPTED) {
      guard += 1;
      expect(guard).toBeLessThan(400);
      const reply = interpreter.execute(payload.subarray(0, payload.length - 2));
      payload = await exchange(device, apdu([CLA_FRAMEWORK, INS_CONTINUE, 0x00, 0x01, reply.length, ...reply]));
    }
    return payload;
  }

  it('Bitcoin Client registers a default wallet and returns an address', async () => {
    const device = handler();
    device.setApp('bitcoin');
    const seed = mnemonicToSeedSync(FOUNDATION);
    const policy = defaultWalletPolicy(seed);
    const serialize = serializeWalletPolicy(policy);
    const interpreter = new ClientCommandInterpreter();
    interpreter.addKnownPreimage(serialize);
    interpreter.addKnownPreimage(new TextEncoder().encode(policy.descriptorTemplate));
    interpreter.addKnownList(policy.keysInfo.map((info) => new TextEncoder().encode(info)));
    const register = [serialize.length, ...serialize];
    const registered = await continueUntilDone(
      device,
      interpreter,
      apdu([0xe1, 0x02, 0x00, 0x01, register.length, ...register]),
    );
    expect(swOf(registered)).toBe(SW_OK);
    expect(registered.length).toBe(66);
    expect(Array.from(registered.subarray(0, 32))).toEqual(Array.from(walletIdOf(serialize)));

    const addressInterp = new ClientCommandInterpreter();
    addressInterp.addKnownPreimage(serialize);
    addressInterp.addKnownPreimage(new TextEncoder().encode(policy.descriptorTemplate));
    addressInterp.addKnownList(policy.keysInfo.map((info) => new TextEncoder().encode(info)));
    const query = [
      0x00,
      ...walletIdOf(serialize),
      ...new Uint8Array(32),
      0x00,
      0x00, 0x00, 0x00, 0x00,
    ];
    const address = await continueUntilDone(
      device,
      addressInterp,
      apdu([0xe1, 0x03, 0x00, 0x01, query.length, ...query]),
    );
    expect(swOf(address)).toBe(SW_OK);
    const text = Array.from(address.subarray(0, address.length - 2), (byte) => String.fromCharCode(byte)).join('');
    expect(text.startsWith('bc1q')).toBe(true);
  });

  it('OKX Bitcoin client accepts shorthand templates whose wildcard is on the key', async () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const cases = [
      { template: 'pkh(@0)', account: "m/44'/0'/0'", prefix: '1' },
      { template: 'sh(wpkh(@0))', account: "m/49'/0'/0'", prefix: '3' },
      { template: 'wpkh(@0)', account: "m/84'/0'/0'", prefix: 'bc1q' },
      { template: 'tr(@0)', account: "m/86'/0'/0'", prefix: 'bc1p' },
    ] as const;
    for (const item of cases) {
      const device = handler();
      device.setApp('bitcoin');
      const base = defaultWalletPolicy(seed, item.template, item.account);
      const policy = {
        version: 1 as const,
        name: '',
        descriptorTemplate: item.template,
        keysInfo: [`${base.keysInfo[0]}/**`],
      };
      const serialize = serializeWalletPolicy(policy);
      const interpreter = new ClientCommandInterpreter();
      interpreter.addKnownPreimage(serialize);
      interpreter.addKnownList(policy.keysInfo.map((info) => new TextEncoder().encode(info)));
      const walletId = walletIdOf(serialize);
      const query = new Uint8Array(70);
      query.set(walletId, 1);
      const address = await continueUntilDone(
        device,
        interpreter,
        apdu([0xe1, 0x03, 0x00, 0x00, query.length, ...query]),
      );
      expect(swOf(address)).toBe(SW_OK);
      const text = Array.from(address.subarray(0, address.length - 2), (byte) => String.fromCharCode(byte)).join('');
      expect(text.startsWith(item.prefix)).toBe(true);
    }
  });

  it('Bitcoin Client signs a merklized PSBT and YIELDs a signature', async () => {
    const device = handler();
    device.setApp('bitcoin');
    const seed = mnemonicToSeedSync(FOUNDATION);
    const master = HDKey.fromMasterSeed(seed);
    const node = master.derive("m/84'/0'/0'/0/0");
    const psbt = buildQrPsbt({
      amount: 10000n,
      pubkey: node.publicKey!,
      fingerprint: master.fingerprint,
      pathIndexes: [0x80000054, 0x80000000, 0x80000000, 0, 0],
      outputScript: concatBytes(Uint8Array.of(0x00, 0x14), new Uint8Array(20).fill(0x33)),
      outputAmount: 8000n,
    });
    const parsed = parsePsbt(psbt);
    const global = psbtMapsToByteMaps([parsed.global])[0]!;
    const inputs = psbtMapsToByteMaps(parsed.inputMaps);
    const outputs = psbtMapsToByteMaps(parsed.outputMaps);
    const policy = defaultWalletPolicy(seed);
    const serialize = serializeWalletPolicy(policy);
    const interpreter = new ClientCommandInterpreter();
    prepareSignPsbtInterpreter(
      interpreter,
      global,
      inputs,
      outputs,
      serialize,
      policy.descriptorTemplate,
      policy.keysInfo,
    );
    const command = encodeSignPsbtCommand(global, inputs, outputs, walletIdOf(serialize));
    const done = await continueUntilDone(
      device,
      interpreter,
      apdu([0xe1, 0x04, 0x00, 0x01, command.length, ...command]),
    );
    expect(swOf(done)).toBe(SW_OK);
    expect(interpreter.yielded.length).toBeGreaterThan(0);
    expect(interpreter.yielded[0]!.length).toBeGreaterThan(70);
  });

  async function signMerklized(template: string, hmac?: Uint8Array): Promise<{ done: Uint8Array; requests: SigningRequest[] }> {
    const requests: SigningRequest[] = [];
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm(request) {
          requests.push(request);
          return true;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    device.setApp('bitcoin');
    const seed = mnemonicToSeedSync(FOUNDATION);
    const master = HDKey.fromMasterSeed(seed);
    const node = master.derive("m/84'/0'/0'/0/0");
    const psbt = buildQrPsbt({
      amount: 10000n,
      pubkey: node.publicKey!,
      fingerprint: master.fingerprint,
      pathIndexes: [0x80000054, 0x80000000, 0x80000000, 0, 0],
      outputScript: concatBytes(Uint8Array.of(0x00, 0x14), new Uint8Array(20).fill(0x33)),
      outputAmount: 8000n,
    });
    const parsed = parsePsbt(psbt);
    const global = psbtMapsToByteMaps([parsed.global])[0]!;
    const inputs = psbtMapsToByteMaps(parsed.inputMaps);
    const outputs = psbtMapsToByteMaps(parsed.outputMaps);
    const policy = defaultWalletPolicy(seed, template);
    const serialize = serializeWalletPolicy(policy);
    const interpreter = new ClientCommandInterpreter();
    prepareSignPsbtInterpreter(
      interpreter,
      global,
      inputs,
      outputs,
      serialize,
      policy.descriptorTemplate,
      policy.keysInfo,
    );
    const command = encodeSignPsbtCommand(
      global,
      inputs,
      outputs,
      walletIdOf(serialize),
      hmac ? Uint8Array.from(hmac) : undefined,
    );
    const done = await continueUntilDone(
      device,
      interpreter,
      apdu([0xe1, 0x04, 0x00, 0x01, command.length, ...command]),
    );
    return { done, requests };
  }

  it('names the policy on the sign sheet when the policy HMAC is all zeros', async () => {
    for (const template of ['wpkh(@0/**)', 'wpkh(@0)'] as const) {
      const { done, requests } = await signMerklized(template);
      expect(swOf(done)).toBe(SW_OK);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.detail?.warning).toMatch(/all zeros/i);
      expect(requests[0]?.detail?.fields.find((field) => field.label === 'POLICY')?.value).toBe(template);
      expect(requests[0]?.detail?.fields.find((field) => field.label === 'TO')).toBeDefined();
    }
  });

  it('keeps a matching policy HMAC off the extra policy warning', async () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const policy = defaultWalletPolicy(seed);
    const hmac = walletHmac(seed, serializeWalletPolicy(policy));
    const { done, requests } = await signMerklized(policy.descriptorTemplate, hmac);
    expect(swOf(done)).toBe(SW_OK);
    expect(requests[0]?.detail?.warning).toBeUndefined();
    expect(requests[0]?.detail?.fields.find((field) => field.label === 'POLICY')).toBeUndefined();
    expect(requests[0]?.detail?.fields.find((field) => field.label === 'FEE')).toBeDefined();
  });

  it('rejects a non-zero policy HMAC that does not match', async () => {
    const hmac = new Uint8Array(32);
    hmac[31] = 1;
    const { done, requests } = await signMerklized('wpkh(@0/**)', hmac);
    expect(swOf(done)).toBe(SW_INS_NOT_SUPPORTED);
    expect(requests).toHaveLength(0);
  });

  const SUI_PATH = [0x8000002c, 0x80000310, 0x80000000, 0x80000000, 0x80000000];

  function encodePathLE(components: number[]): Uint8Array {
    const out = new Uint8Array(1 + components.length * 4);
    out[0] = components.length;
    for (let i = 0; i < components.length; i++) {
      const value = components[i]!;
      const offset = 1 + i * 4;
      out[offset] = value & 0xff;
      out[offset + 1] = (value >>> 8) & 0xff;
      out[offset + 2] = (value >>> 16) & 0xff;
      out[offset + 3] = (value >>> 24) & 0xff;
    }
    return out;
  }

  function suiBlockOf(payload: Uint8Array): { ins: number; body: Uint8Array } {
    const data = payload.subarray(0, payload.length - 2);
    return { ins: data[0]!, body: data.subarray(1) };
  }

  function mystenBlocks(payloads: Uint8Array[]): { start: number[]; chunks: Map<string, Uint8Array> } {
    const chunks = new Map<string, Uint8Array>();
    const hashes: number[] = [];
    for (const payload of payloads) {
      const linked = concatBytes(new Uint8Array(32), payload);
      const hash = sha256(linked);
      chunks.set(bytesToHex(hash), linked);
      hashes.push(...hash);
    }
    return { start: [0x00, ...hashes], chunks };
  }

  async function mystenExchange(
    device: LedgerProtocolHandler,
    ins: number,
    payloads: Uint8Array[],
  ): Promise<Uint8Array> {
    const { start, chunks } = mystenBlocks(payloads);
    let payload = await exchange(device, apdu([0x00, ins, 0x00, 0x00, start.length, ...start]));
    let guard = 0;
    while (suiBlockOf(payload).ins === 0x02) {
      guard += 1;
      expect(guard).toBeLessThan(16);
      expect(swOf(payload)).toBe(SW_OK);
      const hash = suiBlockOf(payload).body;
      const linked = chunks.get(bytesToHex(hash));
      expect(linked).toBeDefined();
      const reply = [0x01, ...linked!];
      payload = await exchange(device, apdu([0x00, ins, 0x00, 0x00, reply.length, ...reply]));
    }
    return payload;
  }

  it('Sui Mysten GET_VERSION uses the blocks protocol and returns the catalog triple', async () => {
    const device = handler();
    device.setApp('sui');
    const payload = await mystenExchange(device, 0x00, [new Uint8Array(1)]);
    expect(swOf(payload)).toBe(SW_OK);
    const block = suiBlockOf(payload);
    expect(block.ins).toBe(0x01);
    const [major, minor, patch] = catalogVersion('sui', '1.5.13')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
    expect(Array.from(block.body)).toEqual([major & 0xff, minor & 0xff, patch & 0xff]);
  });

  it('Sui Mysten silent INS 0x02 exports raw pubkey+address and is not a sign', async () => {
    const confirms: string[] = [];
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: {
        async confirm(request) {
          confirms.push(request.kind);
          return true;
        },
        async getPassphrase() {
          return undefined;
        },
      },
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    device.setApp('sui');
    const payload = await mystenExchange(device, 0x02, [encodePathLE(SUI_PATH)]);
    expect(swOf(payload)).toBe(SW_OK);
    expect(confirms).toEqual([]);
    const block = suiBlockOf(payload);
    expect(block.ins).toBe(0x01);
    expect(block.body[0]).toBe(32);
    const pub = block.body.subarray(1, 33);
    expect(block.body[33]).toBe(32);
    const address = block.body.subarray(34, 66);
    const expectedPub = ed25519PublicKey(deriveEd25519PrivateKey(entropyFromMnemonic(FOUNDATION), "m/44'/784'/0'/0'/0'"));
    expect(Array.from(pub)).toEqual(Array.from(expectedPub));
    expect(Array.from(address)).toEqual(Array.from(suiAddressBytes(expectedPub)));
    expect(suiAddress(pub).startsWith('0x')).toBe(true);
    expect(suiAddress(pub).length).toBe(66);
  });

  it('Sui Mysten display INS 0x01 confirms; silent INS 0x02 still works if confirm would deny', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const deny = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    deny.setApp('sui');
    const shown = await mystenExchange(deny, 0x01, [encodePathLE(SUI_PATH)]);
    expect(swOf(shown)).toBe(SW_DENY);
    const silent = await mystenExchange(deny, 0x02, [encodePathLE(SUI_PATH)]);
    expect(swOf(silent)).toBe(SW_OK);
    expect(suiBlockOf(silent).body[0]).toBe(32);
  });
});
