import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { hashTypedData } from './eip712';
import {
  ETH_DATA_PERSONAL,
  ETH_DATA_TRANSACTION,
  ETH_DATA_TYPED_DATA,
  ETH_DATA_TYPED_TRANSACTION,
  assertEthSignMatchesSeed,
  decodeEthSignRequest,
  decodeEthSignature,
  encodeEthSignRequestCbor,
  encodeEthSignRequestUr,
  signEthRequest,
  type EthSignRequest,
} from './ethSign';
import { encodeEthHdkeyUr } from './hdkey';
import { FountainUrDecoder } from './ur';

const FOUNDATION = 'test test test test test test test test test test test junk';
const EXPECTED = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PATH = "m/44'/60'/0'/0/0";
const REQUEST_ID = Uint8Array.from(
  '9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d'.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
);

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

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
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

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function seedAndFp() {
  const seed = mnemonicToSeedSync(FOUNDATION);
  const encoded = encodeEthHdkeyUr(seed, 'CWS');
  const masterFp = Number.parseInt(encoded.fingerprint, 16);
  const privateKey = HDKey.fromMasterSeed(seed).derive(PATH).privateKey!;
  return { seed, masterFp, privateKey, address: encoded.address };
}

function baseRequest(partial: Partial<EthSignRequest> & Pick<EthSignRequest, 'signData' | 'dataType'>): EthSignRequest {
  const { masterFp, address } = seedAndFp();
  return {
    requestId: REQUEST_ID,
    path: PATH,
    sourceFingerprint: masterFp,
    address,
    origin: 'Rabby',
    chainId: 1,
    ...partial,
  };
}

function verifySig(privateKey: Uint8Array, hash: Uint8Array, signature: Uint8Array) {
  const pub = secp256k1.getPublicKey(privateKey, true);
  expect(secp256k1.verify(signature.subarray(0, 64), hash, pub)).toBe(true);
}

describe('eth-sign-request', () => {
  it('round-trips request-id and signs personal_sign', () => {
    const { seed, privateKey } = seedAndFp();
    const message = new TextEncoder().encode('hello');
    const request = baseRequest({ signData: message, dataType: ETH_DATA_PERSONAL });
    const ur = encodeEthSignRequestUr(request);
    expect(ur.startsWith('ur:eth-sign-request/')).toBe(true);
    const decoded = decodeEthSignRequest(encodeEthSignRequestCbor(request));
    expect([...decoded.requestId]).toEqual([...REQUEST_ID]);
    expect(decoded.path).toBe(PATH);
    expect(decoded.address).toBe(EXPECTED);
    expect(decoded.dataType).toBe(ETH_DATA_PERSONAL);

    const signed = signEthRequest(seed, decoded);
    expect(signed.qr.urKind).toBe('eth-signature');
    expect(signed.qr.ur.startsWith('ur:eth-signature/')).toBe(true);
    expect(signed.signature).toHaveLength(65);
    expect(signed.signature[64]).toBeGreaterThanOrEqual(27);
    expect(signed.signature[64]).toBeLessThanOrEqual(28);
    const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${message.length}`);
    verifySig(privateKey, keccak_256(concat(prefix, message)), signed.signature);
    const decodedSig = decodeEthSignature(new FountainUrDecoder().receive(signed.qr.ur).cbor!);
    expect([...decodedSig.requestId]).toEqual([...REQUEST_ID]);
    expect([...decodedSig.signature]).toEqual([...signed.signature]);
    expect(decodedSig.origin).toBe('Rabby');
  });

  it('signs a legacy RLP transaction with v = recovery+27', () => {
    const { seed, privateKey } = seedAndFp();
    const raw = rlp([
      new Uint8Array(),
      fromHex('0x3b9aca00'),
      fromHex('0x5208'),
      fromHex('0x1111111111111111111111111111111111111111'),
      fromHex('0x0de0b6b3a7640000'),
      new Uint8Array(),
      Uint8Array.of(1),
      new Uint8Array(),
      new Uint8Array(),
    ]);
    const signed = signEthRequest(seed, baseRequest({ signData: raw, dataType: ETH_DATA_TRANSACTION }));
    expect(signed.signature[64]).toBeGreaterThanOrEqual(27);
    verifySig(privateKey, keccak_256(raw), signed.signature);
  });

  it('signs an EIP-1559 typed tx with yParity 0/1', () => {
    const { seed, privateKey } = seedAndFp();
    const payload = rlp([
      Uint8Array.of(1),
      new Uint8Array(),
      fromHex('0x3b9aca00'),
      fromHex('0x77359400'),
      fromHex('0x5208'),
      fromHex('0x1111111111111111111111111111111111111111'),
      fromHex('0x01'),
      new Uint8Array(),
      [],
    ]);
    const raw = concat(Uint8Array.of(0x02), payload);
    const signed = signEthRequest(seed, baseRequest({ signData: raw, dataType: ETH_DATA_TYPED_TRANSACTION }));
    expect(signed.signature[64]).toBeLessThanOrEqual(1);
    verifySig(privateKey, keccak_256(raw), signed.signature);
  });

  it('signs EIP-712 typed data', () => {
    const { seed, privateKey } = seedAndFp();
    const json = new TextEncoder().encode(JSON.stringify(MAIL));
    const signed = signEthRequest(seed, baseRequest({ signData: json, dataType: ETH_DATA_TYPED_DATA }));
    expect(signed.signature[64]).toBeGreaterThanOrEqual(27);
    verifySig(privateKey, hashTypedData(json), signed.signature);
  });

  it('rejects a mismatched master fingerprint or address', () => {
    const { seed } = seedAndFp();
    const request = baseRequest({
      signData: new TextEncoder().encode('hello'),
      dataType: ETH_DATA_PERSONAL,
      sourceFingerprint: 1,
    });
    expect(() => assertEthSignMatchesSeed(seed, request)).toThrow('errors.qrXfp');
    expect(() =>
      assertEthSignMatchesSeed(
        seed,
        baseRequest({
          signData: new TextEncoder().encode('hello'),
          dataType: ETH_DATA_PERSONAL,
          address: '0x0000000000000000000000000000000000000001',
        }),
      ),
    ).toThrow('errors.qrAddress');
  });

  it('reassembles an animated fountain UR', () => {
    const request = baseRequest({
      signData: new TextEncoder().encode('hello from rabby animated qr'),
      dataType: ETH_DATA_PERSONAL,
    });
    const cbor = encodeEthSignRequestCbor(request);
    const encoder = new UREncoder(new UR(Buffer.from(cbor), 'eth-sign-request'), 30);
    const decoder = new FountainUrDecoder();
    let progress = decoder.receive('not-a-ur');
    expect(progress.complete).toBe(false);
    for (let index = 0; index < 40; index += 1) {
      progress = decoder.receive(encoder.nextPart());
      if (progress.complete) {
        break;
      }
    }
    expect(progress.complete).toBe(true);
    expect(progress.success).toBe(true);
    expect(progress.type).toBe('eth-sign-request');
    const decoded = decodeEthSignRequest(progress.cbor!);
    expect(decoded.origin).toBe('Rabby');
    expect(new TextDecoder().decode(decoded.signData)).toBe('hello from rabby animated qr');
  });
});
