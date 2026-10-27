import { describe, expect, it } from 'vitest';
import type { SigningRequest } from './signing';
import { describeBtcPsbt, describeEthTypedData, describeSigning, hex0x, parseEthTx } from './signingPreview';

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

type RlpItem = Uint8Array | RlpItem[];

function rlpBytes(data: Uint8Array): Uint8Array {
  if (data.length === 1 && data[0]! < 0x80) {
    return data;
  }
  if (data.length <= 55) {
    return concat(Uint8Array.of(0x80 + data.length), data);
  }
  const len = [];
  let n = data.length;
  while (n > 0) {
    len.unshift(n & 0xff);
    n >>= 8;
  }
  return concat(Uint8Array.of(0xb7 + len.length), Uint8Array.from(len), data);
}

function rlp(value: RlpItem): Uint8Array {
  if (value instanceof Uint8Array) {
    return rlpBytes(value);
  }
  const body = concat(...value.map(rlp));
  if (body.length <= 55) {
    return concat(Uint8Array.of(0xc0 + body.length), body);
  }
  const len = [];
  let n = body.length;
  while (n > 0) {
    len.unshift(n & 0xff);
    n >>= 8;
  }
  return concat(Uint8Array.of(0xf7 + len.length), Uint8Array.from(len), body);
}

function rlpList(items: Uint8Array[]): Uint8Array {
  return rlp(items);
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function request(partial: Partial<SigningRequest> & Pick<SigningRequest, 'kind' | 'title'>): SigningRequest {
  return {
    brand: 'ledger',
    path: "m/44'/60'/0'/0/0",
    message: partial.title,
    rawPayload: new Uint8Array(),
    ...partial,
  };
}

describe('parseEthTx', () => {
  it('decodes a legacy EIP-155 unsigned transaction', () => {
    const to = fromHex('0x1111111111111111111111111111111111111111');
    const value = fromHex('0x0de0b6b3a7640000');
    const raw = rlpList([
      new Uint8Array(),
      fromHex('0x3b9aca00'),
      fromHex('0x5208'),
      to,
      value,
      new Uint8Array(),
      fromHex('0x01'),
      new Uint8Array(),
      new Uint8Array(),
    ]);
    const parsed = parseEthTx(raw);
    expect(parsed?.type).toBe('legacy');
    expect(parsed?.to).toEqual(to);
    expect(parsed?.value).toEqual(value);
    expect(parsed?.chainId).toEqual(fromHex('0x01'));
  });

  it('decodes an EIP-1559 typed envelope', () => {
    const to = fromHex('0x2222222222222222222222222222222222222222');
    const data = fromHex('0xa9059cbb00000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000001');
    const inner = rlp([
      fromHex('0x01'),
      fromHex('0x05'),
      fromHex('0x3b9aca00'),
      fromHex('0x77359400'),
      fromHex('0x5208'),
      to,
      new Uint8Array(),
      data,
      [],
    ]);
    const raw = concat(Uint8Array.of(0x02), inner);
    const parsed = parseEthTx(raw);
    expect(parsed?.type).toBe('eip1559');
    expect(parsed?.to).toEqual(to);
    expect(parsed?.data).toEqual(data);
  });

  it('decodes EIP-4844 blob fields', () => {
    const to = fromHex('0x1111111111111111111111111111111111111111');
    const inner = rlp([
      fromHex('0xaa36a7'),
      new Uint8Array(),
      fromHex('0x3b9aca00'),
      fromHex('0x77359400'),
      fromHex('0x5208'),
      to,
      new Uint8Array(),
      new Uint8Array(),
      [],
      fromHex('0x3b9aca00'),
      [new Uint8Array(32).fill(0x01)],
    ]);
    const parsed = parseEthTx(concat(Uint8Array.of(0x03), inner));
    expect(parsed?.type).toBe('eip4844');
    expect(parsed?.blobCount).toBe(1);
    expect(parsed?.maxFeePerBlobGas).toEqual(fromHex('0x3b9aca00'));
  });

  it('decodes EIP-7702 authorization lists', () => {
    const to = fromHex('0x1111111111111111111111111111111111111111');
    const inner = rlp([
      fromHex('0xaa36a7'),
      new Uint8Array(),
      fromHex('0x3b9aca00'),
      fromHex('0x77359400'),
      fromHex('0x5208'),
      to,
      new Uint8Array(),
      new Uint8Array(),
      [],
      [[fromHex('0xaa36a7'), to, new Uint8Array(), Uint8Array.of(1), new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)]],
    ]);
    const parsed = parseEthTx(concat(Uint8Array.of(0x04), inner));
    expect(parsed?.type).toBe('eip7702');
    expect(parsed?.authorizationCount).toBe(1);
  });
});

describe('describeSigning', () => {
  it('decodes a legacy ETH tx into labeled fields', () => {
    const to = fromHex('0x1111111111111111111111111111111111111111');
    const value = fromHex('0x0de0b6b3a7640000');
    const data = fromHex('0xa9059cbbdeadbeef');
    const raw = rlpList([
      fromHex('0x09'),
      fromHex('0x3b9aca00'),
      fromHex('0x5208'),
      to,
      value,
      data,
      fromHex('0x01'),
      new Uint8Array(),
      new Uint8Array(),
    ]);
    const detail = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign Ethereum transaction',
        rawPayload: raw,
      }),
    );
    expect(detail.style).toBe('eth-tx');
    expect(detail.decodeFailed).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'TO')?.value).toBe(hex0x(to));
    expect(detail.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 ETH');
    expect(detail.fields.find((field) => field.label === 'WEI')?.value).toBe('1000000000000000000 wei');
    expect(detail.fields.find((field) => field.label === 'NONCE')?.value).toBe('9');
    expect(detail.fields.find((field) => field.label === 'SELECTOR')?.value).toBe('0xa9059cbb');
    expect(detail.fields.find((field) => field.label === 'DATA')?.value).toBe(hex0x(data));
  });

  it('shows UTF-8 personal_sign text', () => {
    const message = new TextEncoder().encode('hello from host');
    const detail = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign message',
        rawPayload: message,
      }),
    );
    expect(detail.style).toBe('eth-message');
    expect(detail.headline).toBe('Personal message');
    expect(detail.fields.find((field) => field.label === 'MESSAGE')?.value).toBe('hello from host');
    expect(detail.hex).toBeUndefined();
  });

  it('shows full hex for opaque generic payloads', () => {
    const payload = fromHex('0xdeadbeefcafebabe');
    const detail = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign Solana',
        path: "m/44'/501'/0'",
        rawPayload: payload,
      }),
    );
    expect(detail.style).toBe('raw-sign');
    expect(detail.fields.find((field) => field.label === 'BYTES')?.value).toBe('8');
    expect(detail.hex).toBe('0xdeadbeefcafebabe');
  });

  it('does not invent an address before confirm', () => {
    const detail = describeSigning(
      request({
        kind: 'address',
        title: 'Export Ethereum address',
        message: "Export Ethereum address\nm/44'/60'/0'/0/0",
        rawPayload: new Uint8Array([0x05, 0x80]),
      }),
    );
    expect(detail.style).toBe('address');
    expect(detail.fields.find((field) => field.label === 'CHAIN')?.value).toBe('Ethereum');
    expect(detail.fields.find((field) => field.label === 'PATH')?.value).toBe("m/44'/60'/0'/0/0");
    expect(detail.fields.some((field) => /0x[0-9a-f]{40}/i.test(field.value))).toBe(false);
    expect(detail.hex).toBeUndefined();
  });

  it('does not fake ETH fields when RLP parse fails', () => {
    const detail = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign Ethereum transaction',
        rawPayload: fromHex('0xdeadbeef'),
      }),
    );
    expect(detail.decodeFailed).toBe(true);
    expect(detail.fields.find((field) => field.label === 'TO')).toBeUndefined();
    expect(detail.hex).toBe('0xdeadbeef');
  });

  it('keeps NEAR transaction payloads as opaque hex', () => {
    const detail = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign NEAR transaction',
        path: "m/44'/397'/0'",
        rawPayload: fromHex('0x01020304'),
      }),
    );
    expect(detail.style).toBe('raw-sign');
    expect(detail.decodeFailed).toBeUndefined();
    expect(detail.hex).toBe('0x01020304');
  });

  it('summarises EIP-712 primaryType and domain name', () => {
    const json = new TextEncoder().encode(
      JSON.stringify({
        primaryType: 'Mail',
        domain: { name: 'Ether Mail' },
        message: {},
      }),
    );
    const detail = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign typed data',
        rawPayload: json,
        detail: describeEthTypedData("m/44'/60'/0'/0/0", json),
      }),
    );
    expect(detail.headline).toBe('EIP-712 typed data');
    expect(detail.fields.find((field) => field.label === 'TYPE')?.value).toBe('Mail');
    expect(detail.fields.find((field) => field.label === 'DOMAIN')?.value).toBe('Ether Mail');
  });

  it('labels Bitcoin PSBT outputs', () => {
    const detail = describeBtcPsbt({
      path: "m/84'/0'/0'/0/0",
      outputs: [{ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amountSats: 100_000n }],
      feeSats: 250n,
    });
    expect(detail.style).toBe('btc-hash');
    expect(detail.fields.find((field) => field.label === 'CHAIN')?.value).toBe('Bitcoin');
    expect(detail.fields.find((field) => field.label === 'TO')?.value).toBe(
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    );
    expect(detail.fields.find((field) => field.label === 'VALUE')?.value).toBe('0.001 BTC');
    expect(detail.fields.find((field) => field.label === 'FEE')?.value).toBe('0.0000025 BTC');
  });

  it('returns attached detail unchanged', () => {
    const attached = describeEthish();
    const detail = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign transaction',
        detail: attached,
        rawPayload: fromHex('0x00'),
      }),
    );
    expect(detail).toBe(attached);
  });
});

function describeEthish() {
  return describeSigning(
    request({
      kind: 'verify',
      title: 'Authenticity check',
      path: 'device',
    }),
  );
}
