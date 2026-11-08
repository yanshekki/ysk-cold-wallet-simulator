import { sha256 } from '@noble/hashes/sha2';
import { concatBytes } from '../bytes';

/**
 * LedgerHQ/app-ton cell hash and TRANSACTION.md / TON Connect signing.
 * Sources (develop / 2.9.1, commit 849962d):
 * - `src/common/cell.c` `hash_Cell`
 * - `src/common/bits.c`
 * - `src/transaction/hash.c` `hash_tx`
 * - `src/transaction/deserialize.c`
 * - `src/transaction/transaction_hints.c` `process_hints`
 * - `src/sign_data/sign_data_deserialize.c`
 * - `src/proof/proof_deserialize.c`
 * - `src/address.c` `pubkey_to_hash`
 */

export const HASH_LEN = 32;
export const DEFAULT_SUBWALLET_ID = 698983191;
export const MAX_TRANSACTION_LEN = 510;
export const MAX_DATA_LEN = 510;
export const MAX_VALUE_BYTES_LEN = 15;
export const MAX_MEMO_LEN = 120;
export const MAX_PLAINTEXT_LENGTH = 120;
export const MAX_APP_DATA_DOMAIN_LENGTH = 126;
export const MAX_DOMAIN_LEN = 128;
export const MAX_PROOF_PAYLOAD_LEN = 128;
export const MAX_CELL_INLINE_LEN = 32;
export const PLAINTEXT_REQUEST = 0x754bf91b;
export const APP_DATA_REQUEST = 0x54b58535;
export const HINT_COMMENT = 0;
export const HINT_TRANSFER_JETTON = 1;
export const HINT_TRANSFER_NFT = 2;
export const HINT_BURN_JETTON = 3;
export const HINT_ADD_WHITELIST = 4;
export const HINT_SINGLE_NOMINATOR_WITHDRAW = 5;
export const HINT_SINGLE_NOMINATOR_CHANGE_VALIDATOR = 6;
export const HINT_TONSTAKERS_DEPOSIT = 7;
export const HINT_JETTON_DAO_VOTE = 8;
export const HINT_CHANGE_DNS_RECORD = 9;
export const HINT_TOKEN_BRIDGE_PAY_SWAP = 10;
export const HINT_TONWHALES_POOL_DEPOSIT = 11;
export const HINT_TONWHALES_POOL_WITHDRAW = 12;
export const HINT_VESTING_SEND_MSG_COMMENT = 13;

const DNS_KEY_WALLET = Uint8Array.of(
  0xe8, 0xd4, 0x40, 0x50, 0x87, 0x3d, 0xba, 0x86, 0x5a, 0xa7, 0xc1, 0x70, 0xab, 0x4c, 0xce, 0x64,
  0xd9, 0x08, 0x39, 0xa3, 0x4d, 0xcf, 0xd6, 0xcf, 0x71, 0xd1, 0x4e, 0x02, 0x05, 0x44, 0x3b, 0x1b,
);

/** `src/address.c` Wallet V4 data-cell prefix (descriptor + seqno). */
const DATA_HEADER = Uint8Array.of(0x00, 0x51, 0x00, 0x00, 0x00, 0x00);
const V3R2_DATA_HEADER = Uint8Array.of(0x00, 0x50, 0x00, 0x00, 0x00, 0x00);
const DATA_TAIL = Uint8Array.of(0x40);

const ROOT_HEADER = Uint8Array.of(
  0x02, 0x01, 0x34, 0x00, 0x07, 0x00, 0x00, 0xfe, 0xb5, 0xff, 0x68, 0x20, 0xe2, 0xff, 0x0d, 0x94,
  0x83, 0xe7, 0xe0, 0xd6, 0x2c, 0x81, 0x7d, 0x84, 0x67, 0x89, 0xfb, 0x4a, 0xe5, 0x80, 0xc8, 0x78,
  0x86, 0x6d, 0x95, 0x9d, 0xab, 0xd5, 0xc0,
);

const V3R2_ROOT_HEADER = Uint8Array.of(
  0x02, 0x01, 0x34, 0x00, 0x00, 0x00, 0x00, 0x84, 0xda, 0xfa, 0x44, 0x9f, 0x98, 0xa6, 0x98, 0x77,
  0x89, 0xba, 0x23, 0x23, 0x58, 0x07, 0x2b, 0xc0, 0xf7, 0x6d, 0xc4, 0x52, 0x40, 0x02, 0xa5, 0xd0,
  0x91, 0x8b, 0x9a, 0x75, 0xd2, 0xd5, 0x99,
);

export type CellRef = { maxDepth: number; hash: Uint8Array };
export type TonAddress = { chain: number; hash: Uint8Array };

export type TonTx = {
  tag: number;
  subwalletId: number;
  includeWalletOp: boolean;
  seqno: number;
  timeout: number;
  value: Uint8Array;
  bounce: boolean;
  sendMode: number;
  to: TonAddress;
  stateInit: CellRef | null;
  payload: CellRef | null;
  isBlind: boolean;
};

export class BitString {
  readonly data = new Uint8Array(128);
  cursor = 0;

  storeBit(value: number): void {
    const bit = value > 0 ? 1 : 0;
    const index = this.cursor >> 3;
    const shift = 7 - (this.cursor % 8);
    if (bit) {
      this.data[index] = (this.data[index] ?? 0) | (1 << shift);
    } else {
      this.data[index] = (this.data[index] ?? 0) & ~(1 << shift);
    }
    this.cursor += 1;
  }

  storeUint(value: bigint | number, bits: number): void {
    let remaining = bits;
    let v = typeof value === 'bigint' ? value : BigInt(value);
    while (remaining > 64) {
      this.storeBit(0);
      remaining -= 1;
    }
    for (let i = 0; i < remaining; i += 1) {
      const shift = remaining - i - 1;
      this.storeBit(Number((v >> BigInt(shift)) & 1n));
    }
  }

  storeCoins(value: bigint): void {
    let len = 0;
    let rest = value;
    for (let i = 0; i < 8; i += 1) {
      if (rest > 0n) {
        len += 1;
        rest >>= 8n;
      } else {
        break;
      }
    }
    this.storeUint(len, 4);
    for (let i = 0; i < len; i += 1) {
      this.storeUint(Number((value >> BigInt((len - i - 1) * 8)) & 0xffn), 8);
    }
  }

  storeCoinsBuf(bytes: Uint8Array): void {
    this.storeUint(bytes.length, 4);
    this.storeBuffer(bytes);
  }

  storeBuffer(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.storeUint(byte, 8);
    }
  }

  storeAddress(chain: number, hash: Uint8Array): void {
    this.storeUint(2, 2);
    this.storeUint(0, 1);
    this.storeUint(chain & 0xff, 8);
    this.storeBuffer(hash);
  }

  storeAddressNull(): void {
    this.storeUint(0, 2);
  }

  finalize(): void {
    let pad = this.cursor % 8;
    if (pad > 0) {
      pad = 8 - pad - 1;
      this.storeBit(1);
      while (pad > 0) {
        pad -= 1;
        this.storeBit(0);
      }
    }
  }
}

export function hashCell(bits: BitString, refs: CellRef[] = []): CellRef {
  const len = bits.cursor;
  const d1 = refs.length;
  const d2 = (len >> 3) + ((len + 7) >> 3);
  bits.finalize();
  const parts: Uint8Array[] = [Uint8Array.of(d1, d2), bits.data.subarray(0, bits.cursor / 8)];
  for (const ref of refs) {
    parts.push(Uint8Array.of((ref.maxDepth >> 8) & 0xff, ref.maxDepth & 0xff));
  }
  for (const ref of refs) {
    parts.push(ref.hash);
  }
  let maxDepth = 0;
  if (refs.length > 0) {
    for (const ref of refs) {
      if (ref.maxDepth > maxDepth) maxDepth = ref.maxDepth;
    }
    maxDepth += 1;
  }
  return { maxDepth, hash: sha256(concatBytes(...parts)) };
}

class Cursor {
  constructor(
    readonly data: Uint8Array,
    public offset = 0,
  ) {}

  remaining(): number {
    return this.data.length - this.offset;
  }

  u8(): number | null {
    if (this.offset >= this.data.length) return null;
    const value = this.data[this.offset]!;
    this.offset += 1;
    return value;
  }

  u16be(): number | null {
    if (this.offset + 2 > this.data.length) return null;
    const value = (this.data[this.offset]! << 8) | this.data[this.offset + 1]!;
    this.offset += 2;
    return value;
  }

  u32be(): number | null {
    if (this.offset + 4 > this.data.length) return null;
    const value =
      ((this.data[this.offset]! << 24) |
        (this.data[this.offset + 1]! << 16) |
        (this.data[this.offset + 2]! << 8) |
        this.data[this.offset + 3]!) >>>
      0;
    this.offset += 4;
    return value;
  }

  u48be(): bigint | null {
    if (this.offset + 6 > this.data.length) return null;
    let value = 0n;
    for (let i = 0; i < 6; i += 1) {
      value = (value << 8n) | BigInt(this.data[this.offset + i]!);
    }
    this.offset += 6;
    return value;
  }

  u64be(): bigint | null {
    if (this.offset + 8 > this.data.length) return null;
    let value = 0n;
    for (let i = 0; i < 8; i += 1) {
      value = (value << 8n) | BigInt(this.data[this.offset + i]!);
    }
    this.offset += 8;
    return value;
  }

  bool(): boolean | null {
    const value = this.u8();
    if (value !== 0 && value !== 1) return null;
    return value === 1;
  }

  bytes(length: number): Uint8Array | null {
    if (length < 0 || this.offset + length > this.data.length) return null;
    const out = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  varuint(): Uint8Array | null {
    const size = this.u8();
    if (size == null || size > MAX_VALUE_BYTES_LEN) return null;
    return this.bytes(size);
  }

  address(): TonAddress | null {
    const chain = this.u8();
    const hash = this.bytes(HASH_LEN);
    if (chain == null || !hash) return null;
    return { chain, hash };
  }

  cellRef(): CellRef | null {
    const maxDepth = this.u16be();
    const hash = this.bytes(HASH_LEN);
    if (maxDepth == null || !hash) return null;
    return { maxDepth, hash };
  }
}

function equalHash(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function checkAscii(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte < 0x20 || byte >= 0x7f) return false;
  }
  return true;
}

function u32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function u64be(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = value;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function u32leBytes(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function u64leBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function i32beParts(value: number): Uint8Array {
  return u32be(value >>> 0);
}

function encodeText(bits: BitString, data: Uint8Array): CellRef[] {
  const storeMax = Math.floor((1023 - bits.cursor) / 8);
  if (data.length > storeMax) {
    const inner = new BitString();
    const innerRefs = encodeText(inner, data.subarray(storeMax));
    const selfRef = hashCell(inner, innerRefs);
    bits.storeBuffer(data.subarray(0, storeMax));
    return [selfRef];
  }
  bits.storeBuffer(data);
  return [];
}

function rsplitDot(domain: Uint8Array): { label: Uint8Array; rest: Uint8Array } | null {
  for (let i = domain.length - 1; i >= 0; i -= 1) {
    if (domain[i] === 0x2e) {
      return { label: domain.subarray(i + 1), rest: domain.subarray(0, i) };
    }
  }
  return null;
}

function encodeDomain(bits: BitString, domain: Uint8Array): void {
  let cur = domain;
  let split = rsplitDot(cur);
  while (split) {
    bits.storeBuffer(split.label);
    bits.storeUint(0, 8);
    cur = split.rest;
    split = rsplitDot(cur);
  }
  bits.storeBuffer(cur);
  bits.storeUint(0, 8);
}

function optionalQueryId(buf: Cursor, bits: BitString): boolean {
  const present = buf.bool();
  if (present == null) return false;
  if (present) {
    const queryId = buf.u64be();
    if (queryId == null) return false;
    bits.storeUint(queryId, 64);
    return true;
  }
  bits.storeUint(0, 64);
  return true;
}

/**
 * `process_hints` without UI strings. Comment, jetton (no hardcoded id), NFT,
 * burn, whitelist, nominator, stakers, DAO vote, DNS, bridge, TonWhales, and
 * vesting comment rebuild the payload cell and memcmp `payload.hash`.
 * Unknown types stay blind (`is_blind = true`) the way firmware does.
 */
function processHints(
  tx: TonTx,
  hintsType: number,
  hintsData: Uint8Array,
): boolean {
  if (!tx.payload) {
    tx.isBlind = false;
    return true;
  }
  if (hintsData.length === 0 && hintsType !== HINT_COMMENT) {
    tx.isBlind = true;
    return true;
  }

  tx.isBlind = true;
  const buf = new Cursor(hintsData);
  let cell: CellRef | null = null;

  if (hintsType === HINT_COMMENT) {
    if (hintsData.length > MAX_MEMO_LEN || !checkAscii(hintsData)) return false;
    const bits = new BitString();
    bits.storeUint(0, 32);
    bits.storeBuffer(hintsData);
    cell = hashCell(bits);
  } else if (hintsType === HINT_TRANSFER_JETTON || hintsType === HINT_TRANSFER_NFT) {
    const bits = new BitString();
    bits.storeUint(hintsType === HINT_TRANSFER_JETTON ? 0x0f8a7ea5 : 0x5fcc3d14, 32);
    const flags = buf.u8();
    if (flags == null) return false;
    if ((flags & 1) !== 0) {
      const queryId = buf.u64be();
      if (queryId == null) return false;
      bits.storeUint(queryId, 64);
    } else {
      bits.storeUint(0, 64);
    }
    if (hintsType === HINT_TRANSFER_JETTON) {
      if ((flags & 2) !== 0) return false;
      const amount = buf.varuint();
      if (!amount) return false;
      bits.storeCoinsBuf(amount);
    }
    const destination = buf.address();
    const response = buf.address();
    if (!destination || !response) return false;
    bits.storeAddress(destination.chain, destination.hash);
    bits.storeAddress(response.chain, response.hash);
    const refs: CellRef[] = [];
    const custom = buf.bool();
    if (custom == null) return false;
    if (custom) {
      const ref = buf.cellRef();
      if (!ref) return false;
      bits.storeBit(1);
      refs.push(ref);
    } else {
      bits.storeBit(0);
    }
    const fwd = buf.varuint();
    if (!fwd) return false;
    bits.storeCoinsBuf(fwd);
    const forward = buf.bool();
    if (forward == null) return false;
    if (forward) {
      const ref = buf.cellRef();
      if (!ref) return false;
      bits.storeBit(1);
      refs.push(ref);
    } else {
      bits.storeBit(0);
    }
    if (buf.remaining() !== 0) return false;
    cell = hashCell(bits, refs);
  } else if (hintsType === HINT_BURN_JETTON) {
    const bits = new BitString();
    bits.storeUint(0x595f07bc, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const amount = buf.varuint();
    const response = buf.address();
    if (!amount || !response) return false;
    bits.storeCoinsBuf(amount);
    bits.storeAddress(response.chain, response.hash);
    const refs: CellRef[] = [];
    const type = buf.u8();
    if (type === 0x00) {
      bits.storeBit(0);
    } else if (type === 0x01) {
      const ref = buf.cellRef();
      if (!ref) return false;
      bits.storeBit(1);
      refs.push(ref);
    } else if (type === 0x02) {
      const len = buf.u8();
      if (len == null || len > MAX_CELL_INLINE_LEN) return false;
      const data = buf.bytes(len);
      if (!data) return false;
      const inner = new BitString();
      inner.storeBuffer(data);
      refs.push(hashCell(inner));
      bits.storeBit(1);
    } else {
      return false;
    }
    if (buf.remaining() !== 0) return false;
    cell = hashCell(bits, refs);
  } else if (hintsType === HINT_ADD_WHITELIST || hintsType === HINT_SINGLE_NOMINATOR_CHANGE_VALIDATOR) {
    const bits = new BitString();
    bits.storeUint(hintsType === HINT_ADD_WHITELIST ? 0x7258a69b : 0x1001, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const addr = buf.address();
    if (!addr || buf.remaining() !== 0) return false;
    bits.storeAddress(addr.chain, addr.hash);
    cell = hashCell(bits);
  } else if (hintsType === HINT_SINGLE_NOMINATOR_WITHDRAW) {
    const bits = new BitString();
    bits.storeUint(0x1000, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const amount = buf.varuint();
    if (!amount || buf.remaining() !== 0) return false;
    bits.storeCoinsBuf(amount);
    cell = hashCell(bits);
  } else if (hintsType === HINT_TONSTAKERS_DEPOSIT) {
    const bits = new BitString();
    bits.storeUint(0x47d54391, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const hasApp = buf.bool();
    if (hasApp == null) return false;
    if (hasApp) {
      const appId = buf.u64be();
      if (appId == null) return false;
      bits.storeUint(appId, 64);
    }
    if (buf.remaining() !== 0) return false;
    cell = hashCell(bits);
  } else if (hintsType === HINT_JETTON_DAO_VOTE) {
    const bits = new BitString();
    bits.storeUint(0x69fb306c, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const voting = buf.address();
    const expiration = buf.u48be();
    const vote = buf.bool();
    const need = buf.bool();
    if (!voting || expiration == null || vote == null || need == null || buf.remaining() !== 0) return false;
    bits.storeAddress(voting.chain, voting.hash);
    bits.storeUint(expiration, 48);
    bits.storeBit(vote ? 1 : 0);
    bits.storeBit(need ? 1 : 0);
    cell = hashCell(bits);
  } else if (hintsType === HINT_CHANGE_DNS_RECORD) {
    const bits = new BitString();
    bits.storeUint(0x4eb1f0f9, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const hasValue = buf.bool();
    const type = buf.u8();
    if (hasValue == null || type == null) return false;
    const refs: CellRef[] = [];
    if (type === 0x00) {
      bits.storeBuffer(DNS_KEY_WALLET);
      if (hasValue) {
        const address = buf.address();
        const hasCapabilities = buf.bool();
        if (!address || hasCapabilities == null) return false;
        let isWallet = false;
        if (hasCapabilities) {
          const flag = buf.bool();
          if (flag == null) return false;
          isWallet = flag;
        }
        const inner = new BitString();
        inner.storeUint(0x9fd3, 16);
        inner.storeAddress(address.chain, address.hash);
        inner.storeUint(hasCapabilities ? 0x01 : 0x00, 8);
        if (hasCapabilities) {
          if (isWallet) {
            inner.storeBit(1);
            inner.storeUint(0x2177, 16);
          }
          inner.storeBit(0);
        }
        refs.push(hashCell(inner));
      }
    } else if (type === 0x01) {
      const key = buf.bytes(32);
      if (!key) return false;
      bits.storeBuffer(key);
      if (hasValue) {
        const ref = buf.cellRef();
        if (!ref) return false;
        refs.push(ref);
      }
    } else {
      return false;
    }
    if (buf.remaining() !== 0) return false;
    cell = hashCell(bits, refs);
  } else if (hintsType === HINT_TOKEN_BRIDGE_PAY_SWAP) {
    const bits = new BitString();
    bits.storeUint(0x8, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const swapId = buf.bytes(32);
    if (!swapId || buf.remaining() !== 0) return false;
    bits.storeBuffer(swapId);
    cell = hashCell(bits);
  } else if (hintsType === HINT_TONWHALES_POOL_DEPOSIT || hintsType === HINT_TONWHALES_POOL_WITHDRAW) {
    const isDeposit = hintsType === HINT_TONWHALES_POOL_DEPOSIT;
    const bits = new BitString();
    bits.storeUint(isDeposit ? 0x7bcd1fef : 0xda803efd, 32);
    const queryId = buf.u64be();
    const gas = buf.varuint();
    if (queryId == null || !gas) return false;
    bits.storeUint(queryId, 64);
    bits.storeCoinsBuf(gas);
    if (!isDeposit) {
      const amount = buf.varuint();
      if (!amount) return false;
      if (amount.length === 0 || (amount.length === 1 && amount[0] === 0)) {
        bits.storeUint(0, 4);
      } else {
        bits.storeCoinsBuf(amount);
      }
    }
    if (buf.remaining() !== 0) return false;
    cell = hashCell(bits);
  } else if (hintsType === HINT_VESTING_SEND_MSG_COMMENT) {
    const bits = new BitString();
    bits.storeUint(0xa7733acd, 32);
    if (!optionalQueryId(buf, bits)) return false;
    const sendMode = buf.u8();
    const dest = buf.address();
    const amount = buf.varuint();
    const commentLen = buf.u8();
    if (sendMode == null || !dest || !amount || commentLen == null || commentLen > MAX_MEMO_LEN) return false;
    const comment = buf.bytes(commentLen);
    if (!comment || !checkAscii(comment) || buf.remaining() !== 0) return false;
    bits.storeUint(sendMode, 8);
    const needBodyCell = 1023 - 380 - amount.length * 8 < commentLen * 8 + 32;
    const temp = new BitString();
    temp.storeUint(0, 1);
    temp.storeUint(3, 2);
    temp.storeUint(0, 3);
    temp.storeAddress(dest.chain, dest.hash);
    temp.storeCoinsBuf(amount);
    temp.storeUint(0, 106);
    let internal: CellRef;
    if (needBodyCell) {
      const body = new BitString();
      body.storeUint(0, 32);
      body.storeBuffer(comment);
      const bodyCell = hashCell(body);
      temp.storeBit(1);
      internal = hashCell(temp, [bodyCell]);
    } else {
      temp.storeBit(0);
      temp.storeUint(0, 32);
      temp.storeBuffer(comment);
      internal = hashCell(temp);
    }
    cell = hashCell(bits, [internal]);
  }

  if (cell) {
    if (!equalHash(cell.hash, tx.payload.hash)) return false;
    tx.isBlind = false;
  }
  return true;
}

export function deserializeTonTx(data: Uint8Array): TonTx | null {
  if (data.length > MAX_TRANSACTION_LEN) return null;
  const buf = new Cursor(data);
  const tag = buf.u8();
  if (tag == null || tag >= 0x02) return null;
  let subwalletId = DEFAULT_SUBWALLET_ID;
  let includeWalletOp = true;
  if (tag === 0x01) {
    const id = buf.u32be();
    const include = buf.bool();
    if (id == null || include == null) return null;
    subwalletId = id;
    includeWalletOp = include;
  }
  const seqno = buf.u32be();
  const timeout = buf.u32be();
  const value = buf.varuint();
  const to = buf.address();
  const bounce = buf.bool();
  const sendMode = buf.u8();
  if (seqno == null || timeout == null || !value || !to || bounce == null || sendMode == null) return null;
  const hasStateInit = buf.bool();
  if (hasStateInit == null) return null;
  const stateInit = hasStateInit ? buf.cellRef() : null;
  if (hasStateInit && !stateInit) return null;
  const hasPayload = buf.bool();
  if (hasPayload == null) return null;
  const payload = hasPayload ? buf.cellRef() : null;
  if (hasPayload && !payload) return null;
  const hasHints = buf.bool();
  if (hasHints == null) return null;
  let hintsType = 0;
  let hintsData = new Uint8Array();
  if (hasHints) {
    if (!hasPayload) return null;
    const type = buf.u32be();
    const len = buf.u16be();
    if (type == null || len == null) return null;
    const body = buf.bytes(len);
    if (!body) return null;
    hintsType = type;
    hintsData = Uint8Array.from(body);
  }
  if (buf.remaining() !== 0) return null;
  const tx: TonTx = {
    tag,
    subwalletId,
    includeWalletOp,
    seqno,
    timeout,
    value,
    bounce,
    sendMode,
    to,
    stateInit,
    payload,
    isBlind: false,
  };
  if (!payload) {
    tx.isBlind = false;
    return tx;
  }
  if (!hasHints) {
    tx.isBlind = true;
    return tx;
  }
  if (!processHints(tx, hintsType, hintsData)) return null;
  return tx;
}

export function hashTonTx(tx: TonTx): Uint8Array | null {
  const bits = new BitString();
  bits.storeBit(0);
  bits.storeBit(1);
  bits.storeBit(tx.bounce ? 1 : 0);
  bits.storeBit(0);
  bits.storeAddressNull();
  bits.storeAddress(tx.to.chain, tx.to.hash);
  bits.storeCoinsBuf(tx.value);
  bits.storeBit(0);
  bits.storeCoins(0n);
  bits.storeCoins(0n);
  bits.storeUint(0, 64);
  bits.storeUint(0, 32);

  let internal: CellRef;
  if (tx.payload && tx.stateInit) {
    bits.storeBit(1);
    bits.storeBit(1);
    bits.storeBit(1);
    internal = hashCell(bits, [tx.stateInit, tx.payload]);
  } else if (tx.payload) {
    bits.storeBit(0);
    bits.storeBit(1);
    internal = hashCell(bits, [tx.payload]);
  } else if (tx.stateInit) {
    bits.storeBit(1);
    bits.storeBit(1);
    bits.storeBit(0);
    internal = hashCell(bits, [tx.stateInit]);
  } else {
    bits.storeBit(0);
    bits.storeBit(0);
    internal = hashCell(bits);
  }

  const order = new BitString();
  order.storeUint(tx.subwalletId, 32);
  order.storeUint(tx.timeout, 32);
  order.storeUint(tx.seqno, 32);
  if (tx.includeWalletOp) {
    order.storeUint(0, 8);
  }
  order.storeUint(tx.sendMode, 8);
  return hashCell(order, [internal]).hash;
}

export type TonSignData = {
  schemaCrc: number;
  timestamp: bigint;
  cellHash: Uint8Array;
  signMessage: Uint8Array;
};

export function deserializeTonSignData(data: Uint8Array): TonSignData | null {
  if (data.length > MAX_DATA_LEN) return null;
  const buf = new Cursor(data);
  const schemaCrc = buf.u32be();
  const timestamp = buf.u64be();
  if (schemaCrc == null || timestamp == null) return null;
  const bits = new BitString();
  const refs: CellRef[] = [];
  if (schemaCrc === PLAINTEXT_REQUEST) {
    const rest = buf.bytes(buf.remaining());
    if (!rest || rest.length > MAX_PLAINTEXT_LENGTH || !checkAscii(rest)) return null;
    refs.push(...encodeText(bits, rest));
  } else if (schemaCrc === APP_DATA_REQUEST) {
    const hasAddress = buf.bool();
    if (hasAddress == null) return null;
    if (hasAddress) {
      const addr = buf.address();
      if (!addr) return null;
      bits.storeBit(1);
      bits.storeAddress(addr.chain, addr.hash);
    } else {
      bits.storeBit(0);
    }
    const hasDomain = buf.bool();
    if (hasDomain == null) return null;
    if (!hasAddress && !hasDomain) return null;
    if (hasDomain) {
      const domainLen = buf.u8();
      if (domainLen == null || domainLen > MAX_APP_DATA_DOMAIN_LENGTH) return null;
      const domain = buf.bytes(domainLen);
      if (!domain || !checkAscii(domain)) return null;
      const inner = new BitString();
      encodeDomain(inner, domain);
      refs.push(hashCell(inner));
      bits.storeBit(1);
    } else {
      bits.storeBit(0);
    }
    const dataRef = buf.cellRef();
    if (!dataRef) return null;
    refs.push(dataRef);
    const hasExt = buf.bool();
    if (hasExt == null) return null;
    if (hasExt) {
      const ext = buf.cellRef();
      if (!ext) return null;
      refs.push(ext);
      bits.storeBit(1);
    } else {
      bits.storeBit(0);
    }
  } else {
    return null;
  }
  if (buf.remaining() !== 0) return null;
  const cellHash = hashCell(bits, refs).hash;
  return {
    schemaCrc,
    timestamp,
    cellHash,
    signMessage: concatBytes(u32be(schemaCrc), u64be(timestamp), cellHash),
  };
}

export function pubkeyToHash(publicKey: Uint8Array, subwalletId: number, isV3r2: boolean): Uint8Array {
  const inner = isV3r2
    ? sha256(concatBytes(V3R2_DATA_HEADER, u32be(subwalletId), publicKey))
    : sha256(concatBytes(DATA_HEADER, u32be(subwalletId), publicKey, DATA_TAIL));
  return sha256(concatBytes(isV3r2 ? V3R2_ROOT_HEADER : ROOT_HEADER, inner));
}

export function tonConnectProofHash(input: {
  workchain: number;
  addressHash: Uint8Array;
  domain: Uint8Array;
  timestamp: bigint;
  payload: Uint8Array;
}): Uint8Array {
  const prefix = new TextEncoder().encode('ton-proof-item-v2/');
  const inner = sha256(
    concatBytes(
      prefix,
      i32beParts(input.workchain),
      input.addressHash,
      u32leBytes(input.domain.length),
      input.domain,
      u64leBytes(input.timestamp),
      input.payload,
    ),
  );
  return sha256(concatBytes(Uint8Array.of(0xff, 0xff), new TextEncoder().encode('ton-connect'), inner));
}

export function encodeTonSignResponse(signature: Uint8Array, hash: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(signature.length), signature, Uint8Array.of(hash.length), hash);
}
