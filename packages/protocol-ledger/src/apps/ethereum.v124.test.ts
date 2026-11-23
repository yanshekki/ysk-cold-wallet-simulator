import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hashTypedData,
  resetLedgerVersionPicks,
  setLedgerVersionPicks,
  type ConfirmationPort,
} from '@cws/contracts';
import { parseApdu, SW_OK, SW_WRONG_LENGTH, SW_WRONG_P1P2 } from '../apdu';
import { concatBytes, writeU16BE, writeU32BE } from '../bytes';
import { derivePrivateKey, signSecp256k1Recoverable } from '../crypto';
import { handleEthereumApdu, MAX_PERSONAL_SIGN_BYTES, type EthSession } from './ethereum';

const FOUNDATION = 'test test test test test test test test test test test junk';
const ETH_PATH = [0x8000002c, 0x8000003c, 0x80000000, 0, 0];
const SW_INCORRECT_DATA = 0x6a80;
const SW_COMMAND_NOT_ALLOWED = 0x6980;
const SW_WRONG_PARAMETER = 0x6b00;

const MAIL = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: {
      name: 'Cow',
      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    },
    to: {
      name: 'Bob',
      wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    },
    contents: 'Hello, Bob!',
  },
};

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

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function derLen(length: number): Uint8Array {
  if (length < 0x80) {
    return Uint8Array.of(length);
  }
  if (length < 0x100) {
    return Uint8Array.of(0x81, length);
  }
  return Uint8Array.of(0x82, (length >> 8) & 0xff, length & 0xff);
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag), derLen(value.length), value);
}

function field(name: string, solType: number, extra: Uint8Array[] = []): Uint8Array {
  return concatBytes(tlv(0x00, Uint8Array.of(0x01)), tlv(0x01, utf8(name)), tlv(0x02, Uint8Array.of(solType)), ...extra);
}

function struct(name: string, fields: Uint8Array[]): Uint8Array {
  return concatBytes(
    tlv(0x00, Uint8Array.of(0x01)),
    tlv(0x01, utf8(name)),
    ...fields.map((item) => tlv(0x02, item)),
  );
}

function mailSchema(): Uint8Array {
  const domain = struct('EIP712Domain', [
    field('name', 5),
    field('version', 5),
    field('chainId', 2, [tlv(0x03, Uint8Array.of(32))]),
    field('verifyingContract', 3),
  ]);
  const person = struct('Person', [field('name', 5), field('wallet', 3)]);
  const mail = struct('Mail', [
    field('from', 0, [tlv(0x05, utf8('Person'))]),
    field('to', 0, [tlv(0x05, utf8('Person'))]),
    field('contents', 5),
  ]);
  return concatBytes(tlv(0x00, Uint8Array.of(0x01)), tlv(0x01, domain), tlv(0x01, person), tlv(0x01, mail));
}

function personSeq(name: string, wallet: string): Uint8Array {
  return concatBytes(tlv(0x00, utf8(name)), tlv(0x00, hexToBytes(wallet)));
}

function mailValues(contents: string): Uint8Array {
  const path = concatBytes(...ETH_PATH.map((component) => writeU32BE(component)));
  const domain = concatBytes(
    tlv(0x00, utf8('Ether Mail')),
    tlv(0x00, utf8('1')),
    tlv(0x00, Uint8Array.of(0x01)),
    tlv(0x00, hexToBytes('0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC')),
  );
  const message = concatBytes(
    tlv(0x01, personSeq('Cow', '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826')),
    tlv(0x01, personSeq('Bob', '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB')),
    tlv(0x00, utf8(contents)),
  );
  return concatBytes(
    tlv(0x00, Uint8Array.of(0x01)),
    tlv(0x01, utf8('Mail')),
    tlv(0x02, path),
    tlv(0x03, domain),
    tlv(0x04, message),
  );
}

function v2First(ins: number, payload: Uint8Array): Uint8Array {
  const head = payload.subarray(0, Math.min(payload.length, 253));
  return encodeApdu(0xe0, ins, 0x01, 0x02, concatBytes(writeU16BE(payload.length), head));
}

function v2Follow(ins: number, payload: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let offset = 253; offset < payload.length; offset += 255) {
    out.push(encodeApdu(0xe0, ins, 0x00, 0x02, payload.subarray(offset, offset + 255)));
  }
  return out;
}

async function sendV2(ins: number, payload: Uint8Array, ctx: ReturnType<typeof ethCtx>): Promise<Uint8Array> {
  let reply = await handleEthereumApdu(parseApdu(v2First(ins, payload)), ctx);
  expect(reply).not.toBeNull();
  for (const chunk of v2Follow(ins, payload)) {
    expect(statusWord(reply!)).toBe(SW_OK);
    reply = await handleEthereumApdu(parseApdu(chunk), ctx);
    expect(reply).not.toBeNull();
  }
  return reply!;
}

const TO = new Uint8Array(20).fill(0x11);
const TO_ITEM = concatBytes(Uint8Array.of(0x94), TO);

function rlpListShort(items: Uint8Array[]): Uint8Array {
  const inner = concatBytes(...items);
  if (inner.length > 55) {
    throw new Error('test helper: inner RLP list longer than 55 bytes');
  }
  return concatBytes(Uint8Array.of(0xc0 + inner.length), inner);
}

function overlayFields(items: Uint8Array[], fields: Array<Uint8Array | undefined>): Uint8Array[] {
  const next = items.slice();
  for (const [index, value] of fields.entries()) {
    if (value) {
      next[index] = value;
    }
  }
  return next;
}

function legacyTx(fields: Array<Uint8Array | undefined> = []): Uint8Array {
  return rlpListShort(
    overlayFields(
      [
        Uint8Array.of(0x80),
        Uint8Array.of(0x01),
        Uint8Array.of(0x82, 0x52, 0x08),
        TO_ITEM,
        Uint8Array.of(0x80),
        Uint8Array.of(0x80),
        Uint8Array.of(0x01),
        Uint8Array.of(0x80),
        Uint8Array.of(0x80),
      ],
      fields,
    ),
  );
}

function eip1559Tx(fields: Array<Uint8Array | undefined> = []): Uint8Array {
  return concatBytes(
    Uint8Array.of(0x02),
    rlpListShort(
      overlayFields(
        [
          Uint8Array.of(0x01),
          Uint8Array.of(0x80),
          Uint8Array.of(0x01),
          Uint8Array.of(0x01),
          Uint8Array.of(0x82, 0x52, 0x08),
          TO_ITEM,
          Uint8Array.of(0x80),
          Uint8Array.of(0x80),
          Uint8Array.of(0xc0),
        ],
        fields,
      ),
    ),
  );
}

async function signTx(raw: Uint8Array): Promise<Uint8Array> {
  const data = concatBytes(encodePath(ETH_PATH), raw);
  const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x04, 0x00, 0x00, data)), ethCtx());
  expect(reply).not.toBeNull();
  return reply!;
}

function expectedTypedSig(digest: Uint8Array): Uint8Array {
  const sig = signSecp256k1Recoverable(derivePrivateKey(entropyFromMnemonic(FOUNDATION), "m/44'/60'/0'/0/0"), digest);
  return concatBytes(Uint8Array.of((sig[64] ?? 0) + 27), sig.subarray(0, 64));
}

afterEach(() => {
  resetLedgerVersionPicks();
});

describe('Ledger Ethereum 1.24.0 SIGN_TX RLP', () => {
  it('reports 1.24.0 from GET_APP_CONFIGURATION when that version is picked', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x06, 0x00, 0x00, new Uint8Array())), ethCtx());
    expect(statusWord(reply!)).toBe(SW_OK);
    expect(Array.from(reply!.subarray(0, 4))).toEqual([0x01, 1, 24, 0]);
  });

  it('rejects trailing bytes after a complete RLP item with 6A80 when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const data = concatBytes(encodePath(ETH_PATH), legacyTx(), Uint8Array.of(0x00));
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x04, 0x00, 0x00, data)), ethCtx());
    expect(statusWord(reply!)).toBe(SW_INCORRECT_DATA);
    expect(reply!.length).toBe(2);
  });

  it('rejects non-canonical long-form RLP length with 6A80 when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const inner = legacyTx().subarray(1);
    const nonCanonical = concatBytes(Uint8Array.of(0xf8, inner.length), inner);
    const reply = await signTx(nonCanonical);
    expect(statusWord(reply)).toBe(SW_INCORRECT_DATA);
    expect(reply.length).toBe(2);
  });

  it('rejects non-canonical single-byte RLP (0x81 + byte ≤ 0x7f) with 6A80 when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const reply = await signTx(legacyTx([undefined, Uint8Array.of(0x81, 0x01)]));
    expect(statusWord(reply)).toBe(SW_INCORRECT_DATA);
    expect(reply.length).toBe(2);
  });

  it.each([
    ['nonce', [Uint8Array.of(0x82, 0x00, 0x01)]],
    ['nonce self-encoded zero', [Uint8Array.of(0x00)]],
    ['gasPrice', [undefined, Uint8Array.of(0x82, 0x00, 0x01)]],
    ['gasLimit', [undefined, undefined, Uint8Array.of(0x83, 0x00, 0x52, 0x08)]],
    ['value', [undefined, undefined, undefined, undefined, Uint8Array.of(0x82, 0x00, 0x01)]],
    ['v', [undefined, undefined, undefined, undefined, undefined, undefined, Uint8Array.of(0x82, 0x00, 0x01)]],
  ] as Array<[string, Array<Uint8Array | undefined>]>)(
    'rejects integer leading zeros on %s with 6A80 when ≥ 1.24.0',
    async (_name, fields) => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const reply = await signTx(legacyTx([...fields]));
    expect(statusWord(reply)).toBe(SW_INCORRECT_DATA);
    expect(reply.length).toBe(2);
  });

  it('rejects integer leading zeros on EIP-1559 chainId with 6A80 when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const reply = await signTx(eip1559Tx([Uint8Array.of(0x82, 0x00, 0x01)]));
    expect(statusWord(reply)).toBe(SW_INCORRECT_DATA);
    expect(reply.length).toBe(2);
  });

  it('signs a canonical legacy transaction when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const reply = await signTx(legacyTx());
    expect(statusWord(reply)).toBe(SW_OK);
    expect(reply.length).toBe(67);
    expect(reply[0] === 27 || reply[0] === 28).toBe(true);
  });

  it('signs a canonical EIP-1559 transaction when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const reply = await signTx(eip1559Tx());
    expect(statusWord(reply)).toBe(SW_OK);
    expect(reply.length).toBe(67);
  });

  it('still signs calldata whose first byte is 0x00 when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const reply = await signTx(
      legacyTx([undefined, undefined, undefined, undefined, undefined, Uint8Array.of(0x82, 0x00, 0x01)]),
    );
    expect(statusWord(reply)).toBe(SW_OK);
    expect(reply.length).toBe(67);
  });

  it('still signs the RLP prefix when trailing bytes arrive on the catalog default', async () => {
    const data = concatBytes(encodePath(ETH_PATH), legacyTx(), Uint8Array.of(0x00));
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x04, 0x00, 0x00, data)), ethCtx());
    expect(statusWord(reply!)).toBe(SW_OK);
    expect(reply!.length).toBe(67);
  });

  it('still signs integer leading zeros on the catalog default', async () => {
    const reply = await signTx(legacyTx([Uint8Array.of(0x82, 0x00, 0x01)]));
    expect(statusWord(reply)).toBe(SW_OK);
    expect(reply.length).toBe(67);
  });
});

describe('Ledger Ethereum 1.24.0 personal_sign length', () => {
  it('rejects a u32 length with the high 16 bits set instead of truncating to 16384', async () => {
    const declared = 0x00014000;
    expect(declared & 0xffff).toBe(MAX_PERSONAL_SIGN_BYTES);
    const data = concatBytes(encodePath(ETH_PATH), writeU32BE(declared));
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x08, 0x00, 0x00, data)), ethCtx());
    expect(statusWord(reply!)).toBe(SW_WRONG_LENGTH);
    expect(reply!.length).toBe(2);
  });

  it('rejects a personal_sign length above 0xFFFF with 6A80 when ≥ 1.24.0', async () => {
    setLedgerVersionPicks({ ethereum: '1.24.0' });
    const data = concatBytes(encodePath(ETH_PATH), writeU32BE(0x00010000));
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x08, 0x00, 0x00, data)), ethCtx());
    expect(statusWord(reply!)).toBe(SW_INCORRECT_DATA);
    expect(reply!.length).toBe(2);
  });
});

describe('Ledger Ethereum 1.24.0 EIP-712 V2', () => {
  it('refuses V2 schema during a V1 flow with 6980', async () => {
    const ctx = ethCtx();
    const name = utf8('EIP712Domain');
    const v1 = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x1a, 0x00, 0x00, name)), ctx);
    expect(statusWord(v1!)).toBe(SW_OK);
    const v2 = await handleEthereumApdu(parseApdu(v2First(0x1a, mailSchema())), ctx);
    expect(statusWord(v2!)).toBe(SW_COMMAND_NOT_ALLOWED);
  });

  it('refuses V1 struct definition during a V2 flow with 6980', async () => {
    const ctx = ethCtx();
    const schema = await sendV2(0x1a, mailSchema(), ctx);
    expect(statusWord(schema)).toBe(SW_OK);
    const v1 = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x1a, 0x00, 0x00, utf8('EIP712Domain'))), ctx);
    expect(statusWord(v1!)).toBe(SW_COMMAND_NOT_ALLOWED);
  });

  it('refuses V0 hashed sign during a V2 flow with 6980', async () => {
    const ctx = ethCtx();
    await sendV2(0x1a, mailSchema(), ctx);
    const hashed = concatBytes(encodePath(ETH_PATH), new Uint8Array(64).fill(0x11));
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x0c, 0x00, 0x00, hashed)), ctx);
    expect(statusWord(reply!)).toBe(SW_COMMAND_NOT_ALLOWED);
  });

  it('refuses V2 sign without schema and values with 6980', async () => {
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x0c, 0x00, 0x02, new Uint8Array())), ethCtx());
    expect(statusWord(reply!)).toBe(SW_COMMAND_NOT_ALLOWED);
  });

  it('refuses V2 sign with Lc ≠ 0 as 6A80', async () => {
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x0c, 0x00, 0x02, Uint8Array.of(0x00))), ethCtx());
    expect(statusWord(reply!)).toBe(SW_INCORRECT_DATA);
    expect(reply!.length).toBe(2);
  });

  it('refuses a malformed EIP-712 V2 schema TLV with 6A80', async () => {
    const reply = await handleEthereumApdu(parseApdu(v2First(0x1a, Uint8Array.of(0x00))), ethCtx());
    expect(statusWord(reply!)).toBe(SW_INCORRECT_DATA);
    expect(reply!.length).toBe(2);
  });

  it('refuses a malformed EIP-712 V2 values TLV with 6A80', async () => {
    const ctx = ethCtx();
    expect(statusWord(await sendV2(0x1a, mailSchema(), ctx))).toBe(SW_OK);
    const reply = await sendV2(0x1c, Uint8Array.of(0x00), ctx);
    expect(statusWord(reply)).toBe(SW_INCORRECT_DATA);
    expect(reply.length).toBe(2);
  });

  it('refuses unknown SIGN EIP 712 P2 with 6B00', async () => {
    const data = concatBytes(encodePath(ETH_PATH), new Uint8Array(64));
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x0c, 0x00, 0x03, data)), ethCtx());
    expect(statusWord(reply!)).toBe(SW_WRONG_PARAMETER);
  });

  it('refuses V2 sign with a non-zero P1 as 6A86', async () => {
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x0c, 0x01, 0x02, new Uint8Array())), ethCtx());
    expect(statusWord(reply!)).toBe(SW_WRONG_P1P2);
  });

  it('refuses V2 filtering during a V2 flow with 6980', async () => {
    const ctx = ethCtx();
    await sendV2(0x1a, mailSchema(), ctx);
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x1e, 0x00, 0x00, new Uint8Array())), ctx);
    expect(statusWord(reply!)).toBe(SW_COMMAND_NOT_ALLOWED);
  });

  it('signs the Ether Mail digest from EIP712_SCHEMA + EIP712_VALUES', async () => {
    const ctx = ethCtx();
    expect(statusWord(await sendV2(0x1a, mailSchema(), ctx))).toBe(SW_OK);
    expect(statusWord(await sendV2(0x1c, mailValues('Hello, Bob!'), ctx))).toBe(SW_OK);
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x0c, 0x00, 0x02, new Uint8Array())), ctx);
    expect(statusWord(reply!)).toBe(SW_OK);
    const digest = hashTypedData(MAIL);
    expect(Buffer.from(digest).toString('hex')).toBe(
      'be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
    );
    expect(Array.from(reply!.subarray(0, 65))).toEqual(Array.from(expectedTypedSig(digest)));
  });

  it('does not produce the Ether Mail signature when a value leaf is mutated', async () => {
    const ctx = ethCtx();
    expect(statusWord(await sendV2(0x1a, mailSchema(), ctx))).toBe(SW_OK);
    expect(statusWord(await sendV2(0x1c, mailValues('Hello, Eve!'), ctx))).toBe(SW_OK);
    const reply = await handleEthereumApdu(parseApdu(encodeApdu(0xe0, 0x0c, 0x00, 0x02, new Uint8Array())), ctx);
    expect(statusWord(reply!)).toBe(SW_OK);
    const canonical = expectedTypedSig(hashTypedData(MAIL));
    expect(Array.from(reply!.subarray(0, 65))).not.toEqual(Array.from(canonical));
  });
});
