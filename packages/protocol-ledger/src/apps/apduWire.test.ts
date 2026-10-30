import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { blake2b } from '@noble/hashes/blake2b';
import { sha3_256 } from '@noble/hashes/sha3';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_MODELS,
  catalogVersion,
  resetLedgerVersionPicks,
  setLedgerVersionPicks,
  type ConfirmationPort,
} from '@cws/contracts';
import { SW_DENY, SW_INS_NOT_SUPPORTED, SW_OK, SW_WRONG_P1P2 } from '../apdu';
import { concatBytes } from '../bytes';
import { deriveEd25519PrivateKey, signEd25519 } from '../crypto';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { deriveIcarus, signIcarus } from './icarus';

const FOUNDATION = 'test test test test test test test test test test test junk';

function entropy(): Uint8Array {
  return mnemonicToEntropy(FOUNDATION, wordlist);
}

function handler(confirm?: ConfirmationPort['confirm']): {
  device: LedgerProtocolHandler;
  confirms: () => number;
} {
  let seen = 0;
  const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
  const device = new LedgerProtocolHandler({
    model: nanoX,
    confirmation: {
      async confirm(request) {
        seen += 1;
        if (confirm) {
          return confirm(request);
        }
        return true;
      },
      async getPassphrase() {
        return undefined;
      },
    },
    slotId: 'slot',
    entropy: entropy(),
  });
  return { device, confirms: () => seen };
}

function apdu(bytes: number[]): Uint8Array {
  return framePayload(TAG_APDU, Uint8Array.from(bytes), DEFAULT_MTU);
}

async function exchange(device: LedgerProtocolHandler, framed: Uint8Array): Promise<Uint8Array> {
  const incoming = splitFramedPackets(framed, DEFAULT_MTU);
  let outgoing: Uint8Array | null = null;
  for (const packet of incoming) {
    outgoing = await device.handleWrite(packet);
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

function statusOf(payload: Uint8Array): number {
  return (payload[payload.length - 2]! << 8) | payload[payload.length - 1]!;
}

function bodyOf(payload: Uint8Array): Uint8Array {
  return payload.subarray(0, payload.length - 2);
}

function encodePath(components: number[]): number[] {
  const out = [components.length];
  for (const component of components) {
    out.push((component >>> 24) & 0xff, (component >>> 16) & 0xff, (component >>> 8) & 0xff, component & 0xff);
  }
  return out;
}

const ADA_PATH = [0x8000073c, 0x80000717, 0x80000000, 0, 0];
const SOL_PATH = [0x8000002c, 0x800001f5, 0x80000000];

function hex(value: string): Uint8Array {
  const bytes = value.match(/../g);
  if (!bytes) {
    throw new Error('empty hex');
  }
  return Uint8Array.from(bytes, (byte) => Number.parseInt(byte, 16));
}

const OPCERT_KES = hex('3d24bc547388cf2403fd978fc3d3a93d1f39acf68a9c00e40512084dc05f2822');
const OPCERT_PERIOD = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x2f);
const OPCERT_COUNTER = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x2a);

function opCertSignedBody(): Uint8Array {
  return concatBytes(OPCERT_KES, OPCERT_COUNTER, OPCERT_PERIOD);
}

function opCertPayload(path: number[]): number[] {
  return [...OPCERT_KES, ...OPCERT_PERIOD, ...OPCERT_COUNTER, ...path];
}

function opCertApdu(body: number[], p1 = 0x00, p2 = 0x00): Uint8Array {
  return apdu([0xd7, 0x22, p1, p2, body.length, ...body]);
}

describe('Cardano SIGN_TX body lengths follow the reported app version', () => {
  it('v8 INIT is empty 9000 and does not open the confirm sheet', async () => {
    expect(catalogVersion('cardano', '0').split('.')[0]).toBe('8');
    const { device, confirms } = handler();
    device.setApp('cardano');
    const init = await exchange(device, apdu([0xd7, 0x21, 0x10, 0x00, 0x08, 0, 0, 0, 0, 0, 0, 0, 1]));
    expect(statusOf(init)).toBe(SW_OK);
    expect(bodyOf(init).length).toBe(0);
    expect(confirms()).toBe(0);
    const chunk = await exchange(device, apdu([0xd7, 0x21, 0x11, 0x00, 0x02, 0xaa, 0xbb]));
    expect(bodyOf(chunk).length).toBe(0);
    expect(confirms()).toBe(0);
  });

  it('v8 CONFIRM refuses to hash a raw APDU payload', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    await exchange(device, apdu([0xd7, 0x21, 0x10, 0x00, 0x01, 0x03]));
    const raw = Uint8Array.of(0x11, 0x22, 0x33, 0x44);
    const confirmed = await exchange(device, apdu([0xd7, 0x21, 0x12, 0x00, raw.length, ...raw]));
    expect(statusOf(confirmed)).toBe(0x6a80);
    expect(bodyOf(confirmed).length).toBe(0);
    expect(Array.from(bodyOf(confirmed))).not.toEqual(Array.from(blake2b(raw, { dkLen: 32 })));
    expect(confirms()).toBe(0);
  });

  it('v8 does not treat v7 confirm P1 0x0A as a 32-byte hash', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const reply = await exchange(device, apdu([0xd7, 0x21, 0x0a, 0x00, 0x00]));
    expect(statusOf(reply)).toBe(SW_WRONG_P1P2);
    expect(bodyOf(reply).length).toBe(0);
    expect(confirms()).toBe(0);
  });

  it('v7 confirm returns 6A80 instead of hashing the concatenated stages', async () => {
    setLedgerVersionPicks({ cardano: '7.2.1' });
    try {
      expect(catalogVersion('cardano', '0')).toBe('7.2.1');
      const { device, confirms } = handler();
      device.setApp('cardano');
      const version = await exchange(device, apdu([0xd7, 0x00, 0x00, 0x00, 0x00]));
      expect(Array.from(bodyOf(version))).toEqual([7, 2, 1, 0]);

      const init = await exchange(device, apdu([0xd7, 0x21, 0x01, 0x00, 0x02, 0x10, 0x20]));
      expect(bodyOf(init).length).toBe(0);
      expect(confirms()).toBe(0);
      // These P1 values are v8 INIT / CHUNK / CONFIRM. On v7 they are empty stages.
      for (const p1 of [0x10, 0x11, 0x12]) {
        const stage = await exchange(device, apdu([0xd7, 0x21, p1, 0x00, 0x01, 0x7f]));
        expect(bodyOf(stage).length).toBe(0);
        expect(confirms()).toBe(0);
      }
      const confirmed = await exchange(device, apdu([0xd7, 0x21, 0x0a, 0x00, 0x00]));
      expect(statusOf(confirmed)).toBe(0x6a80);
      expect(bodyOf(confirmed).length).toBe(0);
      expect(confirms()).toBe(0);
      const uploaded = Uint8Array.of(0x10, 0x20, 0x7f, 0x7f, 0x7f);
      expect(Array.from(blake2b(uploaded, { dkLen: 32 })).length).toBe(32);
    } finally {
      resetLedgerVersionPicks();
    }
  });

  it('v7 CIP-36 aux confirm is not a 64-byte witness', async () => {
    setLedgerVersionPicks({ cardano: '7.2.1' });
    try {
      const { device } = handler();
      device.setApp('cardano');
      const reply = await exchange(device, apdu([0xd7, 0x21, 0x08, 0x34, 0x00]));
      expect(statusOf(reply)).toBe(SW_INS_NOT_SUPPORTED);
      expect(bodyOf(reply).length).toBe(0);
    } finally {
      resetLedgerVersionPicks();
    }
  });

  it('SIGN_OPCERT signs KES, issue counter, then KES period with the pool cold key', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const kes = hex(
      '3d24bc547388cf2403fd978fc3d3a93d1f39acf68a9c00e40512084dc05f2822',
    );
    const period = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x2f);
    const counter = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x2a);
    const path = encodePath([0x8000073d, 0x80000717, 0x80000000, 0x80000000]);
    const reply = await exchange(device, opCertApdu([...kes, ...period, ...counter, ...path]));
    expect(statusOf(reply)).toBe(SW_OK);
    expect(bodyOf(reply).length).toBe(64);
    expect(confirms()).toBe(1);
    const node = deriveIcarus(entropy(), "m/1853'/1815'/0'/0'");
    const signed = concatBytes(kes, counter, period);
    expect(Array.from(bodyOf(reply))).toEqual(Array.from(signIcarus(node, signed)));
    expect(Array.from(bodyOf(reply))).not.toEqual(
      Array.from(signIcarus(node, concatBytes(kes, period, counter))),
    );
  });

  it('SIGN_OPCERT still signs an unusual cold-key index', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const body = opCertPayload(encodePath([0x8000073d, 0x80000717, 0x80000000, 0x800f4241]));
    const reply = await exchange(device, opCertApdu(body));
    expect(statusOf(reply)).toBe(SW_OK);
    expect(bodyOf(reply).length).toBe(64);
    expect(confirms()).toBe(1);
    const node = deriveIcarus(entropy(), "m/1853'/1815'/0'/1000001'");
    expect(Array.from(bodyOf(reply))).toEqual(Array.from(signIcarus(node, opCertSignedBody())));
  });

  it('SIGN_OPCERT rejects a path that is not a pool cold key before the sheet', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const ordinary = encodePath([0x8000073c, 0x80000717, 0x80000000, 2, 0]);
    const denied = await exchange(device, opCertApdu(opCertPayload(ordinary)));
    expect(statusOf(denied)).toBe(0x6982);
    expect(bodyOf(denied).length).toBe(0);
    expect(confirms()).toBe(0);
    const prefix = encodePath([0x8000073d, 0x80000717]);
    expect(statusOf(await exchange(device, opCertApdu(opCertPayload(prefix))))).toBe(0x6982);
    const softIndex = encodePath([0x8000073d, 0x80000717, 0x80000000, 0]);
    expect(statusOf(await exchange(device, opCertApdu(opCertPayload(softIndex))))).toBe(0x6982);
    const usecase = encodePath([0x8000073d, 0x80000717, 0x80000001, 0x80000000]);
    expect(statusOf(await exchange(device, opCertApdu(opCertPayload(usecase))))).toBe(0x6982);
    expect(confirms()).toBe(0);
  });

  it('SIGN_OPCERT parse failures use the operational-certificate status words', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const kes = [...hex('3d24bc547388cf2403fd978fc3d3a93d1f39acf68a9c00e40512084dc05f2822')];
    const period = [0, 0, 0, 0, 0, 0, 0, 0x2f];
    const counter = [0, 0, 0, 0, 0, 0, 0, 0x2a];
    expect(statusOf(await exchange(device, opCertApdu(kes.slice(0, 16))))).toBe(0x6b10);
    expect(statusOf(await exchange(device, opCertApdu([...kes, ...period.slice(0, 4)])))).toBe(0x6b11);
    expect(
      statusOf(await exchange(device, opCertApdu([...kes, ...period, ...counter.slice(0, 4)]))),
    ).toBe(0x6b12);
    expect(statusOf(await exchange(device, opCertApdu([...kes, ...period, ...counter, 0x05])))).toBe(
      0x6b13,
    );
    const path = encodePath([0x8000073d, 0x80000717, 0x80000000, 0x80000000]);
    expect(
      statusOf(await exchange(device, opCertApdu([...kes, ...period, ...counter, ...path, 0xff]))),
    ).toBe(0x6b14);
    expect(statusOf(await exchange(device, opCertApdu(new Array(73).fill(0xaa))))).toBe(0x6b14);
    expect(statusOf(await exchange(device, opCertApdu(opCertPayload(path), 0x01, 0x00)))).toBe(
      SW_WRONG_P1P2,
    );
    expect(confirms()).toBe(0);
  });

  it('a denied SIGN_OPCERT returns 6985 and the other Cardano commands stay 6D00', async () => {
    const { device, confirms } = handler(async () => false);
    device.setApp('cardano');
    const path = encodePath([0x8000073d, 0x80000717, 0x80000000, 0x80000000]);
    const denied = await exchange(device, opCertApdu(opCertPayload(path)));
    expect(statusOf(denied)).toBe(SW_DENY);
    expect(bodyOf(denied).length).toBe(0);
    expect(confirms()).toBe(1);
    const aux = await exchange(device, apdu([0xd7, 0x21, 0x13, 0x36, 0x00]));
    expect(statusOf(aux)).toBe(SW_INS_NOT_SUPPORTED);
  });

  it('an unparsed v8 confirm returns 6A80 and does not open the sheet', async () => {
    const { device, confirms } = handler(async () => false);
    device.setApp('cardano');
    await exchange(device, apdu([0xd7, 0x21, 0x10, 0x00, 0x01, 0x01]));
    const denied = await exchange(device, apdu([0xd7, 0x21, 0x12, 0x00, 0x01, 0x02]));
    expect(statusOf(denied)).toBe(0x6a80);
    expect(bodyOf(denied).length).toBe(0);
    expect(confirms()).toBe(0);
    const pathBytes = encodePath(ADA_PATH);
    const witness = await exchange(device, apdu([0xd7, 0x21, 0x0f, 0x00, pathBytes.length, ...pathBytes]));
    expect(statusOf(witness)).toBe(SW_WRONG_P1P2);
    expect(bodyOf(witness).length).toBe(0);
  });
});

const CVOTE_PATH = [0x8000069e, 0x80000717, 0x80000000, 0, 0];

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function cvoteApdu(p1: number, data: number[], p2 = 0x00): Uint8Array {
  return apdu([0xd7, 0x23, p1, p2, data.length, ...data]);
}

function votecast(length: number): Uint8Array {
  const body = new Uint8Array(length);
  body.fill(0x5a);
  return body;
}

describe('Cardano SIGN_CVOTE hashes the raw votecast', () => {
  it('INIT stays empty and CONFIRM returns the hash and an Icarus signature', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const body = votecast(34);
    const init = await exchange(device, cvoteApdu(0x50, [...u32be(34), ...body]));
    expect(statusOf(init)).toBe(SW_OK);
    expect(bodyOf(init).length).toBe(0);
    expect(confirms()).toBe(0);
    const path = encodePath(CVOTE_PATH);
    const reply = await exchange(device, cvoteApdu(0x52, path));
    expect(statusOf(reply)).toBe(SW_OK);
    expect(bodyOf(reply).length).toBe(96);
    expect(confirms()).toBe(1);
    const hash = blake2b(body, { dkLen: 32 });
    expect(Array.from(bodyOf(reply).subarray(0, 32))).toEqual(Array.from(hash));
    const node = deriveIcarus(entropy(), "m/1694'/1815'/0'/0/0");
    expect(Array.from(bodyOf(reply).subarray(32))).toEqual(Array.from(signIcarus(node, hash)));
  });

  it('a votecast longer than 250 bytes needs a CHUNK before CONFIRM', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const body = votecast(251);
    const init = await exchange(device, cvoteApdu(0x50, [...u32be(251), ...body.subarray(0, 250)]));
    expect(statusOf(init)).toBe(SW_OK);
    expect(confirms()).toBe(0);
    const early = await exchange(device, cvoteApdu(0x52, encodePath(CVOTE_PATH)));
    expect(statusOf(early)).toBe(0x6980);
    const again = await exchange(device, cvoteApdu(0x50, [...u32be(251), ...body.subarray(0, 250)]));
    expect(statusOf(again)).toBe(SW_OK);
    const chunk = await exchange(device, cvoteApdu(0x51, [body[250]!]));
    expect(statusOf(chunk)).toBe(SW_OK);
    expect(bodyOf(chunk).length).toBe(0);
    expect(confirms()).toBe(0);
    const reply = await exchange(device, cvoteApdu(0x52, encodePath(CVOTE_PATH)));
    expect(statusOf(reply)).toBe(SW_OK);
    const hash = blake2b(body, { dkLen: 32 });
    expect(Array.from(bodyOf(reply).subarray(0, 32))).toEqual(Array.from(hash));
    expect(confirms()).toBe(1);
  });

  it('SIGN_CVOTE rejects a non-CIP-36 path and a short plan id before the sheet', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const body = votecast(34);
    await exchange(device, cvoteApdu(0x50, [...u32be(34), ...body]));
    const denied = await exchange(device, cvoteApdu(0x52, encodePath(ADA_PATH)));
    expect(statusOf(denied)).toBe(0x6982);
    expect(bodyOf(denied).length).toBe(0);
    expect(confirms()).toBe(0);
    const short = await exchange(device, cvoteApdu(0x50, [...u32be(10), ...votecast(10)]));
    expect(statusOf(short)).toBe(0x6b51);
    expect(statusOf(await exchange(device, cvoteApdu(0x50, [])))).toBe(0x6b54);
    expect(statusOf(await exchange(device, cvoteApdu(0x50, u32be(0))))).toBe(0x6a87);
    expect(confirms()).toBe(0);
  });

  it('a denied SIGN_CVOTE returns 6985 and drops the vote', async () => {
    const { device, confirms } = handler(async () => false);
    device.setApp('cardano');
    const body = votecast(34);
    await exchange(device, cvoteApdu(0x50, [...u32be(34), ...body]));
    const denied = await exchange(device, cvoteApdu(0x52, encodePath(CVOTE_PATH)));
    expect(statusOf(denied)).toBe(SW_DENY);
    expect(bodyOf(denied).length).toBe(0);
    expect(confirms()).toBe(1);
    const again = await exchange(device, cvoteApdu(0x52, encodePath(CVOTE_PATH)));
    expect(statusOf(again)).toBe(0x6980);
  });
});

function scriptApdu(p1: number, data: number[] = []): Uint8Array {
  return apdu([0xd7, 0x12, p1, 0x00, data.length, ...data]);
}

function u32bytes(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

describe('Cardano native script hash is blake2b-224 of 0x00 and CBOR', () => {
  const keyHash = new Uint8Array(28).fill(0x11);

  function pubkeyScript(hash: Uint8Array): Uint8Array {
    return concatBytes(
      Uint8Array.of(0x00, 0x82, 0x01, 0x81, 0x82, 0x00, 0x58, 0x1c),
      hash,
    );
  }

  it('a key-hash pubkey inside all returns 28 bytes after four sheets', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const init = await exchange(device, scriptApdu(0x00));
    expect(statusOf(init)).toBe(SW_OK);
    expect(bodyOf(init).length).toBe(0);
    const complex = await exchange(device, scriptApdu(0x01, [0x01, ...u32bytes(1)]));
    expect(bodyOf(complex).length).toBe(0);
    const leaf = await exchange(device, scriptApdu(0x02, [0x00, 0x00, ...keyHash]));
    expect(bodyOf(leaf).length).toBe(0);
    const done = await exchange(device, scriptApdu(0x03, [0x02]));
    expect(statusOf(done)).toBe(SW_OK);
    expect(Array.from(bodyOf(done))).toEqual(Array.from(blake2b(pubkeyScript(keyHash), { dkLen: 28 })));
    expect(confirms()).toBe(4);
  });

  it('a device-owned Shelley path hashes that Icarus public key', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    await exchange(device, scriptApdu(0x00));
    await exchange(device, scriptApdu(0x01, [0x01, ...u32bytes(1)]));
    const path = encodePath(ADA_PATH);
    await exchange(device, scriptApdu(0x02, [0x00, 0x02, ...path]));
    const done = await exchange(device, scriptApdu(0x03, [0x01]));
    const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    const hash = blake2b(node.publicKey, { dkLen: 28 });
    expect(Array.from(bodyOf(done))).toEqual(Array.from(blake2b(pubkeyScript(hash), { dkLen: 28 })));
    expect(confirms()).toBe(4);
  });

  it('rejects a script hash, an unclassified path, and an early finish', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    await exchange(device, scriptApdu(0x00));
    const early = await exchange(device, scriptApdu(0x03, [0x02]));
    expect(statusOf(early)).toBe(0x6b43);
    await exchange(device, scriptApdu(0x00));
    await exchange(device, scriptApdu(0x01, [0x01, ...u32bytes(1)]));
    const scriptHash = await exchange(device, scriptApdu(0x02, [0x00, 0x01, ...keyHash]));
    expect(statusOf(scriptHash)).toBe(0x6b41);
    expect(confirms()).toBe(3);
    await exchange(device, scriptApdu(0x00));
    await exchange(device, scriptApdu(0x01, [0x01, ...u32bytes(1)]));
    const foreign = encodePath([0x80000000, 0x80000001, 0x80000002]);
    const denied = await exchange(device, scriptApdu(0x02, [0x00, 0x02, ...foreign]));
    expect(statusOf(denied)).toBe(0x6982);
    expect(confirms()).toBe(5);
  });

  it('a denied native script returns 6985', async () => {
    const { device, confirms } = handler(async () => false);
    device.setApp('cardano');
    const denied = await exchange(device, scriptApdu(0x00));
    expect(statusOf(denied)).toBe(SW_DENY);
    expect(confirms()).toBe(1);
    const next = await exchange(device, scriptApdu(0x01, [0x01, ...u32bytes(1)]));
    expect(statusOf(next)).toBe(0x6980);
  });
});

function cip8Apdu(p1: number, data: number[]): Uint8Array {
  return apdu([0xd7, 0x24, p1, 0x00, data.length, ...data]);
}

function cip8Structure(addressField: Uint8Array, payload: Uint8Array): Uint8Array {
  const fieldHead =
    addressField.length < 24
      ? Uint8Array.of(0x40 | addressField.length)
      : Uint8Array.of(0x58, addressField.length);
  const header = concatBytes(
    Uint8Array.of(0xa2, 0x01, 0x27, 0x67),
    Uint8Array.from('address', (char) => char.charCodeAt(0)),
    fieldHead,
    addressField,
  );
  const payloadHead = payload.length < 24 ? Uint8Array.of(0x40 | payload.length) : Uint8Array.of(0x58, payload.length);
  return concatBytes(
    Uint8Array.of(0x84, 0x6a),
    Uint8Array.from('Signature1', (char) => char.charCodeAt(0)),
    Uint8Array.of(0x58, header.length),
    header,
    Uint8Array.of(0x40),
    payloadHead,
    payload,
  );
}

describe('Cardano CIP-8 key-hash messages sign the COSE structure', () => {
  const message = Uint8Array.from('Hi', (char) => char.charCodeAt(0));

  async function signHi(hashFlag: number): Promise<{ body: Uint8Array; confirms: number }> {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const init = await exchange(
      device,
      cip8Apdu(0x01, [...u32be(message.length), ...encodePath(ADA_PATH), hashFlag, 0x02, 0x02]),
    );
    expect(statusOf(init)).toBe(SW_OK);
    expect(bodyOf(init).length).toBe(0);
    expect(confirms()).toBe(0);
    const chunk = await exchange(device, cip8Apdu(0x02, [...u32be(message.length), ...message]));
    expect(bodyOf(chunk).length).toBe(0);
    expect(confirms()).toBe(0);
    const done = await exchange(device, cip8Apdu(0x03, []));
    expect(statusOf(done)).toBe(SW_OK);
    expect(confirms()).toBe(1);
    return { body: bodyOf(done), confirms: confirms() };
  }

  it('a raw ASCII message is signed as Sig_structure, not as the message', async () => {
    const { body } = await signHi(0x01);
    const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    const keyHash = blake2b(node.publicKey, { dkLen: 28 });
    expect(body.length).toBe(64 + 32 + 4 + 28);
    expect(Array.from(body.subarray(64, 96))).toEqual(Array.from(node.publicKey));
    expect(Array.from(body.subarray(96, 100))).toEqual([0, 0, 0, 28]);
    expect(Array.from(body.subarray(100))).toEqual(Array.from(keyHash));
    const structure = cip8Structure(keyHash, message);
    expect(Array.from(body.subarray(0, 64))).toEqual(Array.from(signIcarus(node, structure)));
    expect(Array.from(body.subarray(0, 64))).not.toEqual(Array.from(signIcarus(node, message)));
  });

  it('a hashed payload signs blake2b-224 of the message', async () => {
    const { body } = await signHi(0x02);
    const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    const keyHash = blake2b(node.publicKey, { dkLen: 28 });
    const payload = blake2b(message, { dkLen: 28 });
    expect(Array.from(body.subarray(0, 64))).toEqual(Array.from(signIcarus(node, cip8Structure(keyHash, payload))));
  });

  it('rejects a CIP-36 path, a non-ASCII flagged message, and an address field', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const vote = await exchange(
      device,
      cip8Apdu(0x01, [...u32be(2), ...encodePath(CVOTE_PATH), 0x01, 0x02, 0x02]),
    );
    expect(statusOf(vote)).toBe(0x6982);
    expect(confirms()).toBe(0);
    const init = await exchange(
      device,
      cip8Apdu(0x01, [...u32be(1), ...encodePath(ADA_PATH), 0x01, 0x02, 0x02]),
    );
    expect(statusOf(init)).toBe(SW_OK);
    const bad = await exchange(device, cip8Apdu(0x02, [...u32be(1), 0x01]));
    expect(statusOf(bad)).toBe(0x6b69);
    const address = await exchange(
      device,
      cip8Apdu(0x01, [...u32be(2), ...encodePath(ADA_PATH), 0x01, 0x02, 0x01]),
    );
    expect(statusOf(address)).toBe(0x6b65);
    const byron = await exchange(
      device,
      cip8Apdu(0x01, [...u32be(2), ...encodePath(ADA_PATH), 0x01, 0x02, 0x01, 0x08]),
    );
    expect(statusOf(byron)).toBe(0x6b65);
    expect(confirms()).toBe(0);
  });
});

const STAKE_PATH = [0x8000073c, 0x80000717, 0x80000000, 2, 0];
const BYRON_PATH = [0x8000002c, 0x80000717, 0x80000000, 0, 0];

function cborHead(major: number, value: number): Uint8Array {
  const type = (major << 5) & 0xe0;
  if (value < 24) {
    return Uint8Array.of(type | value);
  }
  if (value < 256) {
    return Uint8Array.of(type | 24, value);
  }
  if (value < 65536) {
    return Uint8Array.of(type | 25, (value >> 8) & 0xff, value & 0xff);
  }
  return Uint8Array.of(type | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function ieeeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function byronCbor(node: { publicKey: Uint8Array; chainCode: Uint8Array }, magic: number): Uint8Array {
  const extended = concatBytes(node.publicKey, node.chainCode);
  const rootInput = concatBytes(
    cborHead(4, 3),
    cborHead(0, 0),
    cborHead(4, 2),
    cborHead(0, 0),
    concatBytes(cborHead(2, extended.length), extended),
    cborHead(5, 0),
  );
  const root = blake2b(sha3_256(rootInput), { dkLen: 28 });
  const magicBytes = cborHead(0, magic);
  const attributes =
    magic === 764824073
      ? cborHead(5, 0)
      : concatBytes(cborHead(5, 1), cborHead(0, 2), concatBytes(cborHead(2, magicBytes.length), magicBytes));
  const inner = concatBytes(cborHead(4, 3), concatBytes(cborHead(2, root.length), root), attributes, cborHead(0, 0));
  return concatBytes(
    cborHead(4, 2),
    cborHead(6, 24),
    concatBytes(cborHead(2, inner.length), inner),
    cborHead(0, ieeeCrc32(inner)),
  );
}

function enterpriseParams(): number[] {
  return [0x06, 0x01, ...encodePath(ADA_PATH), 0x11];
}

describe('Cardano Shelley address bytes', () => {
  it('returns a 29-byte enterprise address with no sheet', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const reply = await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, enterpriseParams().length, ...enterpriseParams()]));
    expect(statusOf(reply)).toBe(SW_OK);
    expect(confirms()).toBe(0);
    const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    const key = blake2b(node.publicKey, { dkLen: 28 });
    expect(Array.from(bodyOf(reply))).toEqual([0x61, ...key]);
  });

  it('displays an enterprise address and returns an empty body', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const reply = await exchange(device, apdu([0xd7, 0x11, 0x02, 0x00, enterpriseParams().length, ...enterpriseParams()]));
    expect(statusOf(reply)).toBe(SW_OK);
    expect(bodyOf(reply).length).toBe(0);
    expect(confirms()).toBe(1);
  });

  it('returns a 57-byte base address and a 29-byte reward address', async () => {
    const { device } = handler();
    device.setApp('cardano');
    const payment = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    const stake = deriveIcarus(entropy(), "m/1852'/1815'/0'/2/0");
    const base = [
      0x00,
      0x01,
      ...encodePath(ADA_PATH),
      0x22,
      ...encodePath(STAKE_PATH),
    ];
    const baseReply = await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, base.length, ...base]));
    expect(Array.from(bodyOf(baseReply))).toEqual([
      0x01,
      ...blake2b(payment.publicKey, { dkLen: 28 }),
      ...blake2b(stake.publicKey, { dkLen: 28 }),
    ]);
    const reward = [0x0e, 0x01, 0x22, ...encodePath(STAKE_PATH)];
    const rewardReply = await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, reward.length, ...reward]));
    expect(Array.from(bodyOf(rewardReply))).toEqual([0xe1, ...blake2b(stake.publicKey, { dkLen: 28 })]);
  });

  it('rejects Byron, a bad type, and a non-Shelley payment path', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    expect(statusOf(await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, 1, 0x08])))).toBe(0x6b06);
    expect(statusOf(await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, 1, 0x09])))).toBe(0x6b06);
    const byronPath = encodePath([0x8000002c, 0x80000717, 0x80000000, 0, 0]);
    const foreign = [0x06, 0x01, ...byronPath, 0x11];
    expect(statusOf(await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, foreign.length, ...foreign])))).toBe(0x6982);
    expect(confirms()).toBe(0);
  });

  it('returns Byron CBOR for mainnet and for another protocol magic', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const node = deriveIcarus(entropy(), "m/44'/1815'/0'/0/0");
    const main = [0x08, ...u32be(764824073), ...encodePath(BYRON_PATH), 0x11];
    const reply = await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, main.length, ...main]));
    expect(statusOf(reply)).toBe(SW_OK);
    expect(confirms()).toBe(0);
    expect(Array.from(bodyOf(reply))).toEqual(Array.from(byronCbor(node, 764824073)));
    const other = [0x08, ...u32be(1), ...encodePath(BYRON_PATH), 0x11];
    const testnet = await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, other.length, ...other]));
    expect(Array.from(bodyOf(testnet))).toEqual(Array.from(byronCbor(node, 1)));
    const shown = await exchange(device, apdu([0xd7, 0x11, 0x02, 0x00, main.length, ...main]));
    expect(bodyOf(shown).length).toBe(0);
    expect(confirms()).toBe(1);
    const shelley = [0x08, ...u32be(764824073), ...encodePath(ADA_PATH), 0x11];
    expect(statusOf(await exchange(device, apdu([0xd7, 0x11, 0x01, 0x00, shelley.length, ...shelley])))).toBe(
      0x6982,
    );
  });

  it('CIP-8 rejects a valid Byron address', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const params = [0x08, ...u32be(764824073), ...encodePath(BYRON_PATH), 0x11];
    const init = [...u32be(2), ...encodePath(ADA_PATH), 0x01, 0x02, 0x01, ...params];
    expect(statusOf(await exchange(device, cip8Apdu(0x01, init)))).toBe(0x6982);
    expect(confirms()).toBe(0);
  });

  it('CIP-8 address field 01 signs the enterprise address bytes', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const params = enterpriseParams();
    const message = Uint8Array.from('Hi', (char) => char.charCodeAt(0));
    const init = [...u32be(message.length), ...encodePath(ADA_PATH), 0x01, 0x02, 0x01, ...params];
    expect(statusOf(await exchange(device, cip8Apdu(0x01, init)))).toBe(SW_OK);
    expect(confirms()).toBe(0);
    expect(statusOf(await exchange(device, cip8Apdu(0x02, [...u32be(message.length), ...message])))).toBe(SW_OK);
    const done = await exchange(device, cip8Apdu(0x03, []));
    const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    const address = Uint8Array.of(0x61, ...blake2b(node.publicKey, { dkLen: 28 }));
    expect(Array.from(bodyOf(done).subarray(0, 64))).toEqual(
      Array.from(signIcarus(node, cip8Structure(address, message))),
    );
    expect(Array.from(bodyOf(done).subarray(96, 100))).toEqual([0, 0, 0, 29]);
    expect(Array.from(bodyOf(done).subarray(100))).toEqual(Array.from(address));
    expect(confirms()).toBe(1);
  });
});

describe('Solana SIGN_MESSAGE chunk ACKs', () => {
  function solanaHead(message: number[]): number[] {
    const path = encodePath(SOL_PATH);
    return [0x01, ...path, ...message];
  }

  it('a first chunk from the dashboard is Solana, empty 9000, and does not open a sheet', async () => {
    const { device, confirms } = handler();
    expect(device.getApp()).toBe('dashboard');
    const head = solanaHead([0x11, 0x22, 0x33, 0x44]);
    const more = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x02, head.length, ...head]));
    expect(device.getApp()).toBe('solana');
    expect(statusOf(more)).toBe(SW_OK);
    expect(bodyOf(more).length).toBe(0);
    expect(confirms()).toBe(0);

    const rest = [0x55, 0x66];
    const signed = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x01, rest.length, ...rest]));
    expect(statusOf(signed)).toBe(SW_OK);
    expect(bodyOf(signed).length).toBe(64);
    expect(confirms()).toBe(1);
    const message = Uint8Array.of(0x11, 0x22, 0x33, 0x44, 0x55, 0x66);
    const key = deriveEd25519PrivateKey(entropy(), "m/44'/501'/0'");
    expect(Array.from(bodyOf(signed))).toEqual(Array.from(signEd25519(key, message)));
  });

  it('does not answer a Solana sign chunk with the Ethereum version', async () => {
    const { device, confirms } = handler();
    device.setApp('ethereum');
    const head = solanaHead([0x01]);
    const more = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x02, head.length, ...head]));
    expect(device.getApp()).toBe('solana');
    expect(bodyOf(more).length).toBe(0);
    expect(confirms()).toBe(0);

    const version = await exchange(device, apdu([0xe0, 0x06, 0x00, 0x00, 0x00]));
    expect(device.getApp()).toBe('tron');
    expect(bodyOf(version).length).toBe(4);
  });

  it('keeps an empty E0 06 on Ethereum as GET_APP_CONFIGURATION', async () => {
    const { device, confirms } = handler();
    device.setApp('ethereum');
    const version = await exchange(device, apdu([0xe0, 0x06, 0x00, 0x00, 0x00]));
    expect(device.getApp()).toBe('ethereum');
    expect(bodyOf(version).length).toBe(4);
    expect(confirms()).toBe(0);
  });
});
