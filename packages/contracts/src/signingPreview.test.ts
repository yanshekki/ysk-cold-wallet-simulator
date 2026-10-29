import { describe, expect, it } from 'vitest';
import { HOST_NETWORK_TICKER_WARNING } from './evmNativeGas';
import type { SigningRequest } from './signing';
import {
  OPAQUE_CALLDATA_NOTE,
  describeBtcPsbt,
  describeEthTransaction,
  describeEthTypedData,
  describeHostSuppliedDigest,
  describeHostSuppliedHash,
  describeNearDelegate,
  describeNearMessage,
  describeSigning,
  hex0x,
  parseEthTx,
} from './signingPreview';

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
    expect(detail.fields.find((field) => field.label === 'DATA')?.raw).toBe(true);
    expect(detail.fields.find((field) => field.label === 'AMOUNT')).toBeUndefined();
    expect(detail.warning).toBe(OPAQUE_CALLDATA_NOTE);
    expect(detail.note).toBeUndefined();
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

  it('shows NEP-413 message fields on the confirm sheet', () => {
    const nonce = Uint8Array.from({ length: 32 }, (_, index) => index);
    const detail = describeNearMessage({
      path: "m/44'/397'/0'/0'/1'",
      message: 'hi',
      recipient: 'myapp.com',
      nonce,
      callbackUrl: 'myapp.com/callback',
    });
    expect(detail.headline).toBe('Sign NEAR message');
    expect(detail.fields.find((field) => field.label === 'MESSAGE')?.value).toBe('hi');
    expect(detail.fields.find((field) => field.label === 'RECIPIENT')?.value).toBe('myapp.com');
    expect(detail.fields.find((field) => field.label === 'CALLBACK')?.value).toBe('myapp.com/callback');
    expect(detail.hex).toBeUndefined();
    const shown = describeSigning(
      request({
        kind: 'sign',
        title: 'Sign NEAR message',
        path: "m/44'/397'/0'/0'/1'",
        detail,
      }),
    );
    expect(shown).toBe(detail);
  });

  it('shows NEP-366 sender and receiver before the raw payload', () => {
    const raw = fromHex('0x01020304');
    const detail = describeNearDelegate({
      path: "m/44'/397'/0'/0'/1'",
      sender: 'alice.near',
      receiver: 'bob.near',
      actionCount: 1,
      raw,
    });
    expect(detail.headline).toBe('Sign NEAR delegate action');
    expect(detail.fields.find((field) => field.label === 'SENDER')?.value).toBe('alice.near');
    expect(detail.fields.find((field) => field.label === 'RECEIVER')?.value).toBe('bob.near');
    expect(detail.fields.find((field) => field.label === 'ACTIONS')?.value).toBe('1');
    expect(detail.hex).toBe('0x01020304');
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

  it('labels a host-supplied EIP-712 hash instead of typed data', () => {
    const detail = describeHostSuppliedHash({
      path: "m/44'/60'/0'/0/0",
      domainHash: new Uint8Array(32).fill(0x11),
      messageHash: new Uint8Array(32).fill(0x22),
    });
    expect(detail.headline).toBe('Host-supplied hash');
    expect(detail.headline).not.toMatch(/typed data|transaction/i);
    expect(detail.warning).toMatch(/host supplied this hash/i);
    expect(detail.warning).toMatch(/not a decoded transaction/i);
    expect(detail.fields.find((field) => field.label === 'DOMAIN HASH')?.value).toBe(`0x${'11'.repeat(32)}`);
    expect(detail.fields.find((field) => field.label === 'MESSAGE HASH')?.value).toBe(`0x${'22'.repeat(32)}`);
  });

  it('labels a Bitcoin untrusted hash as host-supplied', () => {
    const detail = describeHostSuppliedDigest({
      chain: 'Bitcoin',
      path: "m/44'/0'/0'/0/0",
      hash: new Uint8Array(32).fill(0x11),
    });
    expect(detail.headline).toBe('Host-supplied hash');
    expect(detail.warning).toMatch(/host supplied this hash/i);
    expect(detail.warning).toMatch(/not a decoded transaction/i);
    expect(detail.fields.find((field) => field.label === 'CHAIN')?.value).toBe('Bitcoin');
    expect(detail.fields.find((field) => field.label === 'HASH')?.value).toBe(`0x${'11'.repeat(32)}`);
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
    expect(detail.warning).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'POLICY')).toBeUndefined();
  });

  it('names an unchecked zero-HMAC policy ahead of the outputs', () => {
    const detail = describeBtcPsbt({
      path: "m/84'/0'/0'/0/0",
      outputs: [{ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amountSats: 100_000n }],
      uncheckedPolicy: 'wpkh(@0)',
    });
    expect(detail.warning).toMatch(/all zeros/i);
    expect(detail.fields[0]).toEqual({ label: 'POLICY', value: 'wpkh(@0)', mono: true });
    expect(detail.fields.find((field) => field.label === 'TO')?.value).toBe(
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    );
  });

  it('marks host-provided ERC-20 tickers untrusted and always shows the contract', () => {
    const attacker = fromHex('0x1111111111111111111111111111111111111111');
    const recipient = fromHex('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const data = concat(
      fromHex('0xa9059cbb'),
      concat(new Uint8Array(12), recipient),
      fromHex('0x00000000000000000000000000000000000000000000000000000000000f4240'),
    );
    const detail = describeEthTransaction({
      path: "m/44'/60'/0'/0/0",
      to: attacker,
      data,
      token: { ticker: 'USDT', decimals: 6, contract: attacker },
    });
    expect(detail.headline).toBe('Token transfer');
    expect(detail.headline).not.toMatch(/USDT/);
    expect(detail.warning).toMatch(/host/i);
    expect(detail.note).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'CONTRACT')?.value).toBe(hex0x(attacker));
    expect(detail.fields.find((field) => field.label === 'TO')).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'RECIPIENT')?.value).toBe(hex0x(recipient));
    expect(detail.fields.find((field) => field.label === 'TICKER')?.value).toBe('USDT (host-provided)');
    expect(detail.fields.find((field) => field.label === 'AMOUNT RAW')?.value).toBe('1000000');
    expect(detail.fields.find((field) => field.label === 'DATA')).toBeUndefined();
  });

  it('shows the called address when the host token contract differs', () => {
    const called = fromHex('0x2222222222222222222222222222222222222222');
    const claimed = fromHex('0x1111111111111111111111111111111111111111');
    const recipient = fromHex('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const detail = describeEthTransaction({
      to: called,
      data: erc20Data('a9059cbb', recipient),
      token: { ticker: 'USDT', decimals: 6, contract: claimed },
    });
    expect(detail.fields.find((field) => field.label === 'TO')?.value).toBe(hex0x(called));
    expect(detail.fields.find((field) => field.label === 'CONTRACT')?.value).toBe(hex0x(claimed));
    expect(detail.fields.find((field) => field.label === 'RECIPIENT')?.value).toBe(hex0x(recipient));
  });

  it('decodes an exact approve and does not invent a transfer amount', () => {
    const token = fromHex('0x1111111111111111111111111111111111111111');
    const spender = fromHex('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    const detail = describeEthTransaction({
      to: token,
      data: erc20Data('095ea7b3', spender),
    });
    expect(detail.headline).toBe('Token approve');
    expect(detail.warning).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'SPENDER')?.value).toBe(hex0x(spender));
    expect(detail.fields.find((field) => field.label === 'CONTRACT')?.value).toBe(hex0x(token));
    expect(detail.fields.find((field) => field.label === 'AMOUNT')).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'DATA')).toBeUndefined();
  });

  it('does not read a token amount from a longer payload that starts with transfer', () => {
    const token = fromHex('0x1111111111111111111111111111111111111111');
    const recipient = fromHex('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const detail = describeEthTransaction({
      to: token,
      data: erc20Data('a9059cbb', recipient, Uint8Array.of(0x01)),
      token: { ticker: 'USDC', decimals: 6, contract: token },
    });
    expect(detail.headline).not.toBe('Token transfer');
    expect(detail.warning).toBe(OPAQUE_CALLDATA_NOTE);
    expect(detail.note).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'AMOUNT')).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'AMOUNT RAW')).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'TICKER')).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'DATA')?.raw).toBe(true);
    expect(detail.fields.some((field) => field.value.includes('USDC'))).toBe(false);
  });

  it('does not treat dirty address padding as an ERC-20 transfer', () => {
    const token = fromHex('0x1111111111111111111111111111111111111111');
    const recipient = fromHex('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const data = erc20Data('a9059cbb', recipient);
    data[4] = 0x01;
    const detail = describeEthTransaction({ to: token, data });
    expect(detail.headline).not.toBe('Token transfer');
    expect(detail.warning).toBe(OPAQUE_CALLDATA_NOTE);
    expect(detail.fields.find((field) => field.label === 'RECIPIENT')).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'AMOUNT RAW')).toBeUndefined();
  });

  it('shows Avalanche native fields and leaves router calldata undecoded', () => {
    const router = fromHex('0x2222222222222222222222222222222222222222');
    const data = new Uint8Array(132);
    data.set(fromHex('0x38ed1739'));
    const envelope = `0x${'ab'.repeat(180)}`;
    const detail = describeEthTransaction({
      type: 'eip1559',
      path: "m/44'/60'/0'/0/0",
      chainId: 43114,
      nonce: Uint8Array.of(7),
      maxPriorityFeePerGas: fromHex('0x3b9aca00'),
      maxFeePerGas: fromHex('0x77359400'),
      gasLimit: fromHex('0x030d40'),
      to: router,
      value: new Uint8Array(),
      data,
      token: { ticker: 'USDC', decimals: 6, contract: router },
      envelopeHex: envelope,
    });
    expect(detail.headline).toBe('Avalanche C-Chain transaction');
    expect(detail.warning).toBe(OPAQUE_CALLDATA_NOTE);
    expect(detail.note).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'CHAIN')?.value).toBe('Avalanche C-Chain');
    expect(detail.fields.find((field) => field.label === 'CHAIN ID')?.value).toBe('43114');
    expect(detail.fields.find((field) => field.label === 'TO')?.value).toBe(hex0x(router));
    expect(detail.fields.find((field) => field.label === 'VALUE')?.value).toBe('0 AVAX');
    expect(detail.fields.find((field) => field.label === 'NONCE')?.value).toBe('7');
    expect(detail.fields.find((field) => field.label === 'GAS')?.value).toBe('200000');
    expect(detail.fields.find((field) => field.label === 'MAX FEE')?.value).toMatch(/AVAX/);
    expect(detail.fields.find((field) => field.label === 'FEE')?.value).toMatch(/AVAX$/);
    expect(detail.fields.find((field) => field.label === 'SELECTOR')?.value).toBe('0x38ed1739');
    expect(detail.fields.find((field) => field.label === 'DATA')).toMatchObject({
      raw: true,
      value: hex0x(data),
    });
    expect(detail.hex).toBe(envelope);
    for (const label of ['AMOUNT', 'AMOUNT RAW', 'TICKER', 'METHOD', 'RECIPIENT', 'SPENDER']) {
      expect(detail.fields.find((field) => field.label === label)).toBeUndefined();
    }
    expect(detail.fields.some((field) => field.value.includes('USDC'))).toBe(false);
    expect(sheetUnits(detail)).not.toMatch(/\bETH\b/);
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

describe('EVM gas symbol on the sign sheet', () => {
  const one = fromHex('0x0de0b6b3a7640000');

  it('shows AVAX for Avalanche C-Chain, including the max network fee', () => {
    const detail = describeEthTransaction({
      chainId: 43114,
      value: one,
      gasLimit: fromHex('0x5208'),
      maxFeePerGas: fromHex('0x77359400'),
      maxPriorityFeePerGas: fromHex('0x3b9aca00'),
    });
    expect(detail.headline).toBe('Avalanche C-Chain transaction');
    expect(detail.warning).toBeUndefined();
    expect(detail.note).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'DATA')).toBeUndefined();
    expect(detail.fields.find((field) => field.label === 'CHAIN')?.value).toBe('Avalanche C-Chain');
    expect(detail.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 AVAX');
    expect(detail.fields.find((field) => field.label === 'MAX FEE')?.value).toBe('0.000000002 AVAX / gas');
    expect(detail.fields.find((field) => field.label === 'FEE')?.value).toBe('0.000042 AVAX');
    expect(sheetUnits(detail)).not.toMatch(/\bETH\b/);
  });

  it('shows AVAX when the Avalanche app signs a chain-id template that is not Avalanche', () => {
    const detail = describeEthTransaction({
      app: 'avalanche',
      chainId: fromHex('0xaa36a7'),
      value: new Uint8Array(),
      gasLimit: fromHex('0x5208'),
      gasPrice: fromHex('0x01'),
    });
    expect(detail.headline).toBe('Avalanche C-Chain transaction');
    expect(detail.fields.find((field) => field.label === 'VALUE')?.value).toBe('0 AVAX');
    expect(detail.fields.find((field) => field.label === 'FEE')?.value).toBe('0.000000000000021 AVAX');
    expect(sheetUnits(detail)).not.toMatch(/\bETH\b/);
  });

  it('keeps ETH on Ethereum mainnet and names other ETH-gas networks', () => {
    const mainnet = describeEthTransaction({ chainId: 1, value: one });
    expect(mainnet.headline).toBe('Ethereum transaction');
    expect(mainnet.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 ETH');
    const base = describeEthTransaction({ chainId: 8453, value: one });
    expect(base.headline).toBe('Base transaction');
    expect(base.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 ETH');
  });

  it('uses a neutral unit when the chain id is unknown', () => {
    const detail = describeEthTransaction({ chainId: 424242, value: one, gasPrice: fromHex('0x01'), gasLimit: fromHex('0x01') });
    expect(detail.headline).toBe('EVM transaction');
    expect(detail.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 native');
    expect(detail.fields.find((field) => field.label === 'FEE')?.value).toBe('0.000000000000000001 native');
    expect(sheetUnits(detail)).not.toMatch(/\bETH\b/);
    expect(detail.warning).toBeUndefined();
  });

  it('labels an unverified host ticker and does not let it rename a known chain', () => {
    const hosted = describeEthTransaction({
      chainId: 424242,
      value: one,
      hostNetwork: { ticker: 'FOO', chainId: 424242, name: 'Foo Chain' },
    });
    expect(hosted.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 FOO');
    expect(hosted.warning).toBe(HOST_NETWORK_TICKER_WARNING);
    expect(hosted.note).toBeUndefined();
    const hostedCall = describeEthTransaction({
      chainId: 424242,
      value: one,
      data: fromHex('0x12345678'),
      hostNetwork: { ticker: 'FOO', chainId: 424242, name: 'Foo Chain' },
    });
    expect(hostedCall.warning).toBe(HOST_NETWORK_TICKER_WARNING);
    expect(hostedCall.note).toBe(OPAQUE_CALLDATA_NOTE);
    expect(hostedCall.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 FOO');
    expect(hostedCall.fields.find((field) => field.label === 'SELECTOR')?.value).toBe('0x12345678');
    expect(hostedCall.fields.find((field) => field.label === 'AMOUNT')).toBeUndefined();
    const avalanche = describeEthTransaction({
      chainId: 43114,
      value: one,
      hostNetwork: { ticker: 'ETH', chainId: 43114, name: 'Ethereum' },
    });
    expect(avalanche.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 AVAX');
    expect(avalanche.warning).toBeUndefined();
  });
});

function erc20Data(selector: string, address: Uint8Array, extra?: Uint8Array): Uint8Array {
  const body = concat(
    fromHex(selector),
    new Uint8Array(12),
    address,
    fromHex('0x00000000000000000000000000000000000000000000000000000000000f4240'),
  );
  return extra ? concat(body, extra) : body;
}

function sheetUnits(detail: { fields: Array<{ label: string; value: string }> }): string {
  return detail.fields
    .filter((field) => ['VALUE', 'FEE', 'GAS PRICE', 'MAX FEE', 'MAX PRIORITY', 'BLOB FEE'].includes(field.label))
    .map((field) => field.value)
    .join(' ');
}

function describeEthish() {
  return describeSigning(
    request({
      kind: 'verify',
      title: 'Authenticity check',
      path: 'device',
    }),
  );
}
