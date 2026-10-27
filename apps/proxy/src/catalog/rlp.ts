import { concatBytes, hexToBytes } from './apdu';

type RlpItem = Uint8Array | RlpItem[];

function rlpBytes(data: Uint8Array): Uint8Array {
  if (data.length === 1 && data[0]! < 0x80) {
    return data;
  }
  if (data.length <= 55) {
    return concatBytes(Uint8Array.of(0x80 + data.length), data);
  }
  const len = [];
  let n = data.length;
  while (n > 0) {
    len.unshift(n & 0xff);
    n >>= 8;
  }
  return concatBytes(Uint8Array.of(0xb7 + len.length), Uint8Array.from(len), data);
}

export function rlp(value: RlpItem): Uint8Array {
  if (value instanceof Uint8Array) {
    return rlpBytes(value);
  }
  const body = concatBytes(...value.map(rlp));
  if (body.length <= 55) {
    return concatBytes(Uint8Array.of(0xc0 + body.length), body);
  }
  const len = [];
  let n = body.length;
  while (n > 0) {
    len.unshift(n & 0xff);
    n >>= 8;
  }
  return concatBytes(Uint8Array.of(0xf7 + len.length), Uint8Array.from(len), body);
}

const SEPOLIA = hexToBytes('0xaa36a7');
const TO = hexToBytes('0x1111111111111111111111111111111111111111');
const GAS_PRICE = hexToBytes('0x3b9aca00');
const MAX_FEE = hexToBytes('0x77359400');
const GAS = hexToBytes('0x5208');

const EIP1559_FIELDS: RlpItem[] = [
  SEPOLIA,
  new Uint8Array(),
  GAS_PRICE,
  MAX_FEE,
  GAS,
  TO,
  new Uint8Array(),
  new Uint8Array(),
  [],
];

export function legacyEthTx(): Uint8Array {
  return rlp([
    new Uint8Array(),
    GAS_PRICE,
    GAS,
    TO,
    new Uint8Array(),
    new Uint8Array(),
    SEPOLIA,
    new Uint8Array(),
    new Uint8Array(),
  ]);
}

export function eip2930EthTx(): Uint8Array {
  return concatBytes(
    Uint8Array.of(0x01),
    rlp([SEPOLIA, new Uint8Array(), GAS_PRICE, GAS, TO, new Uint8Array(), new Uint8Array(), []]),
  );
}

export function eip1559EthTx(): Uint8Array {
  return concatBytes(Uint8Array.of(0x02), rlp(EIP1559_FIELDS));
}

export function eip4844EthTx(): Uint8Array {
  return concatBytes(
    Uint8Array.of(0x03),
    rlp([
      SEPOLIA,
      new Uint8Array(),
      GAS_PRICE,
      MAX_FEE,
      GAS,
      TO,
      new Uint8Array(),
      new Uint8Array(),
      [],
      GAS_PRICE,
      [new Uint8Array(32).fill(0x01)],
    ]),
  );
}

export function eip7702EthTx(): Uint8Array {
  return concatBytes(
    Uint8Array.of(0x04),
    rlp([
      SEPOLIA,
      new Uint8Array(),
      GAS_PRICE,
      MAX_FEE,
      GAS,
      TO,
      new Uint8Array(),
      new Uint8Array(),
      [],
      [[SEPOLIA, TO, new Uint8Array(), Uint8Array.of(1), new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)]],
    ]),
  );
}

export function garbageEthTx(): Uint8Array {
  return Uint8Array.of(0x03, 0xff, 0x00, 0x01);
}

export function erc20TransferEthTx(): Uint8Array {
  const selector = hexToBytes('0xa9059cbb');
  const toWord = concatBytes(new Uint8Array(12), TO);
  const amount = hexToBytes('0x' + '00'.repeat(31) + '01');
  const data = concatBytes(selector, toWord, amount);
  return concatBytes(Uint8Array.of(0x02), rlp([...EIP1559_FIELDS.slice(0, 7), data, []]));
}

function rlpInt(bytes: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset < bytes.length - 1 && bytes[offset] === 0) {
    offset += 1;
  }
  if (offset === bytes.length - 1 && bytes[offset] === 0) {
    return new Uint8Array();
  }
  return bytes.subarray(offset);
}

/** Device returns v||r||s (v is y-parity for typed txs). */
export function eip1559Signed(sig: Uint8Array): Uint8Array {
  if (sig.length < 65) {
    throw new Error('need 65-byte signature');
  }
  const yParity = sig[0] & 1;
  return concatBytes(
    Uint8Array.of(0x02),
    rlp([
      ...EIP1559_FIELDS,
      yParity === 0 ? new Uint8Array() : Uint8Array.of(yParity),
      rlpInt(sig.subarray(1, 33)),
      rlpInt(sig.subarray(33, 65)),
    ]),
  );
}

