import { concatBytes } from '../bytes';
import { base58 } from '@scure/base';

/**
 * Solana message parse matching trezor-firmware `core/v2.13.1`
 * (`4289e23b317e98ab6a5e8237723e0cd57f44934c`)
 * `core/src/apps/solana/transaction/__init__.py` and `parse.py`.
 *
 * Legacy / v0 compact-u16 bodies, plus SIMD-0385 v1 (header `0x81`, config mask,
 * instruction headers then payloads). Sysvar slot checks follow
 * `instruction.py` `SYSVAR_ACCOUNTS` and named account templates.
 */

export const SOLANA_SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const SOLANA_STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111';
export const SOLANA_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SOLANA_TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SOLANA_ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SOLANA_CLOCK_SYSVAR_ID = 'SysvarC1ock11111111111111111111111111111111';
export const SOLANA_RENT_SYSVAR_ID = 'SysvarRent111111111111111111111111111111111';
export const SOLANA_STAKE_HISTORY_SYSVAR_ID = 'SysvarStakeHistory1111111111111111111111111';
export const SOLANA_RECENT_BLOCKHASHES_SYSVAR_ID = 'SysvarRecentB1ockHashes11111111111111111111';

const SYSTEM_TRANSFER = 2;
const CONFIG_PRIORITY_FEE = 0b00011;
const CONFIG_COMPUTE_UNIT_LIMIT = 0b00100;
const CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 0b01000;
const CONFIG_HEAP_SIZE = 0b10000;
const CONFIG_KNOWN_BITS =
  CONFIG_PRIORITY_FEE | CONFIG_COMPUTE_UNIT_LIMIT | CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT | CONFIG_HEAP_SIZE;
const V1_INSTRUCTION_HEADER_SIZE = 4;

type SysvarName = 'clock_sysvar' | 'rent_sysvar' | 'stake_history_sysvar' | 'recent_blockhashes_sysvar';

const SYSVAR_PUBKEYS: Record<SysvarName, Uint8Array> = {
  clock_sysvar: base58.decode(SOLANA_CLOCK_SYSVAR_ID),
  rent_sysvar: base58.decode(SOLANA_RENT_SYSVAR_ID),
  stake_history_sysvar: base58.decode(SOLANA_STAKE_HISTORY_SYSVAR_ID),
  recent_blockhashes_sysvar: base58.decode(SOLANA_RECENT_BLOCKHASHES_SYSVAR_ID),
};

type SysvarSlot = { name: SysvarName; index: number };

const SYSVAR_SLOTS: Record<string, Record<string, readonly SysvarSlot[]>> = {
  [SOLANA_SYSTEM_PROGRAM_ID]: {
    '4': [{ name: 'recent_blockhashes_sysvar', index: 1 }],
    '5': [
      { name: 'recent_blockhashes_sysvar', index: 2 },
      { name: 'rent_sysvar', index: 3 },
    ],
    '6': [
      { name: 'recent_blockhashes_sysvar', index: 1 },
      { name: 'rent_sysvar', index: 2 },
    ],
  },
  [SOLANA_STAKE_PROGRAM_ID]: {
    '0': [{ name: 'rent_sysvar', index: 1 }],
    '1': [{ name: 'clock_sysvar', index: 1 }],
    '2': [
      { name: 'clock_sysvar', index: 2 },
      { name: 'stake_history_sysvar', index: 3 },
    ],
    '4': [
      { name: 'clock_sysvar', index: 2 },
      { name: 'stake_history_sysvar', index: 3 },
    ],
    '5': [{ name: 'clock_sysvar', index: 1 }],
    '7': [
      { name: 'clock_sysvar', index: 2 },
      { name: 'stake_history_sysvar', index: 3 },
    ],
    '8': [{ name: 'clock_sysvar', index: 2 }],
    '9': [{ name: 'rent_sysvar', index: 1 }],
    '10': [{ name: 'clock_sysvar', index: 1 }],
    '11': [{ name: 'clock_sysvar', index: 2 }],
  },
  [SOLANA_TOKEN_PROGRAM_ID]: {
    '1': [{ name: 'rent_sysvar', index: 3 }],
    '2': [{ name: 'rent_sysvar', index: 1 }],
    '16': [{ name: 'rent_sysvar', index: 2 }],
  },
  [SOLANA_TOKEN_2022_PROGRAM_ID]: {
    '1': [{ name: 'rent_sysvar', index: 3 }],
    '2': [{ name: 'rent_sysvar', index: 1 }],
    '16': [{ name: 'rent_sysvar', index: 2 }],
  },
  [SOLANA_ATA_PROGRAM_ID]: {
    none: [{ name: 'rent_sysvar', index: 6 }],
  },
};

export type SolanaAccountRef =
  | { kind: 'static'; pubkey: Uint8Array }
  | { kind: 'lookup'; table: Uint8Array; index: number };

export type SolanaRawInstruction = {
  programIndex: number;
  accounts: number[];
  data: Uint8Array;
};

export type ParsedSolanaTransaction = {
  version: number | null;
  requiredSigners: number;
  addresses: Uint8Array[];
  blockhash: Uint8Array;
  instructions: SolanaRawInstruction[];
  lookupRw: SolanaAccountRef[];
  lookupRo: SolanaAccountRef[];
  lookupTableCount: number;
  configPriorityFee: bigint;
};

class TxReader {
  offset = 0;

  constructor(readonly data: Uint8Array) {}

  remaining(): number {
    return this.data.length - this.offset;
  }

  peek(): number {
    if (this.offset >= this.data.length) {
      throw new Error('eof');
    }
    return this.data[this.offset]!;
  }

  u8(): number {
    if (this.offset >= this.data.length) {
      throw new Error('eof');
    }
    return this.data[this.offset++]!;
  }

  bytes(count: number): Uint8Array {
    if (count < 0 || this.remaining() < count) {
      throw new Error('eof');
    }
    const slice = this.data.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  u16le(): number {
    const bytes = this.bytes(2);
    return bytes[0]! | (bytes[1]! << 8);
  }

  u32le(): number {
    const bytes = this.bytes(4);
    return (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
  }

  u64le(): bigint {
    const bytes = this.bytes(8);
    let value = 0n;
    for (let index = 0; index < 8; index += 1) {
      value |= BigInt(bytes[index]!) << BigInt(8 * index);
    }
    return value;
  }
}

/** compact-u16 from trezor-firmware `transaction/parse.py` `parse_var_int`. */
function compactU16(reader: TxReader): number {
  let value = 0;
  for (let index = 0; index < 3; index += 1) {
    const byte = reader.u8();
    if (byte === 0 && index !== 0) {
      throw new Error('alias compact-u16');
    }
    value |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) {
      if (value > 0xffff) {
        throw new Error('compact-u16 too large');
      }
      return value;
    }
  }
  throw new Error('compact-u16 unterminated');
}

function pubkey(reader: TxReader): Uint8Array {
  return reader.bytes(32);
}

function instructionIdLength(programId: string): number {
  if (programId === SOLANA_SYSTEM_PROGRAM_ID || programId === SOLANA_STAKE_PROGRAM_ID) {
    return 4;
  }
  if (
    programId === SOLANA_TOKEN_PROGRAM_ID ||
    programId === SOLANA_TOKEN_2022_PROGRAM_ID ||
    programId === SOLANA_ATA_PROGRAM_ID
  ) {
    return 1;
  }
  return 0;
}

function readInstructionId(programId: string, data: Uint8Array): number | null {
  const length = instructionIdLength(programId);
  if (length <= 0 || data.length < length) {
    return null;
  }
  if (length === 1) {
    return data[0]!;
  }
  return (data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24)) >>> 0;
}

function same32(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== 32 || right.length !== 32) {
    return false;
  }
  for (let index = 0; index < 32; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function parseHeader(reader: TxReader): { version: number | null; requiredSigners: number; sigReadOnly: number; readOnly: number } {
  let version: number | null = null;
  if ((reader.peek() & 0x80) !== 0) {
    version = reader.u8() & 0x7f;
    if (version > 1) {
      throw new Error('unsupported version');
    }
  }
  return {
    version,
    requiredSigners: reader.u8(),
    sigReadOnly: reader.u8(),
    readOnly: reader.u8(),
  };
}

function parseAddresses(
  reader: TxReader,
  count: number,
  requiredSigners: number,
  sigReadOnly: number,
  readOnly: number,
): Uint8Array[] {
  if (sigReadOnly >= requiredSigners) {
    throw new Error('no writable signer');
  }
  if (count < requiredSigners + readOnly) {
    throw new Error('not enough addresses');
  }
  const addresses: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    addresses.push(pubkey(reader));
  }
  return addresses;
}

function parseConfig(reader: TxReader, mask: number): bigint {
  if ((mask | CONFIG_KNOWN_BITS) !== CONFIG_KNOWN_BITS) {
    throw new Error('unsupported config');
  }
  const priorityBits = mask & CONFIG_PRIORITY_FEE;
  if (priorityBits !== 0 && priorityBits !== CONFIG_PRIORITY_FEE) {
    throw new Error('invalid config');
  }
  const priorityFee = priorityBits ? reader.u64le() : 0n;
  for (const bit of [CONFIG_COMPUTE_UNIT_LIMIT, CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT, CONFIG_HEAP_SIZE]) {
    if (mask & bit) {
      reader.u32le();
    }
  }
  return priorityFee;
}

function parseLegacyInstructions(reader: TxReader): SolanaRawInstruction[] {
  const count = compactU16(reader);
  const instructions: SolanaRawInstruction[] = [];
  for (let index = 0; index < count; index += 1) {
    const programIndex = reader.u8();
    const accountCount = compactU16(reader);
    const accounts = Array.from(reader.bytes(accountCount));
    const dataLength = compactU16(reader);
    const data = reader.bytes(dataLength);
    instructions.push({ programIndex, accounts, data });
  }
  return instructions;
}

function parseV1Instructions(reader: TxReader, count: number): SolanaRawInstruction[] {
  const headers = new TxReader(reader.bytes(V1_INSTRUCTION_HEADER_SIZE * count));
  const instructions: SolanaRawInstruction[] = [];
  for (let index = 0; index < count; index += 1) {
    const programIndex = headers.u8();
    const accountCount = headers.u8();
    const dataLength = headers.u16le();
    const accounts = Array.from(reader.bytes(accountCount));
    const data = reader.bytes(dataLength);
    instructions.push({ programIndex, accounts, data });
  }
  return instructions;
}

function parseLookups(
  reader: TxReader,
  version: number | null,
): { rw: SolanaAccountRef[]; ro: SolanaAccountRef[]; tableCount: number } {
  const rw: SolanaAccountRef[] = [];
  const ro: SolanaAccountRef[] = [];
  if (version !== 0) {
    return { rw, ro, tableCount: 0 };
  }
  const tables = compactU16(reader);
  for (let tableIndex = 0; tableIndex < tables; tableIndex += 1) {
    const table = pubkey(reader);
    const rwCount = compactU16(reader);
    for (let index = 0; index < rwCount; index += 1) {
      rw.push({ kind: 'lookup', table, index: reader.u8() });
    }
    const roCount = compactU16(reader);
    for (let index = 0; index < roCount; index += 1) {
      ro.push({ kind: 'lookup', table, index: reader.u8() });
    }
  }
  return { rw, ro, tableCount: tables };
}

function parseBody(serialized: Uint8Array): ParsedSolanaTransaction {
  const reader = new TxReader(serialized);
  const header = parseHeader(reader);
  let addresses: Uint8Array[];
  let blockhash: Uint8Array;
  let instructions: SolanaRawInstruction[];
  let lookupRw: SolanaAccountRef[] = [];
  let lookupRo: SolanaAccountRef[] = [];
  let lookupTableCount = 0;
  let configPriorityFee = 0n;
  if (header.version === 1) {
    const mask = reader.u32le();
    blockhash = pubkey(reader);
    const instructionCount = reader.u8();
    const addressCount = reader.u8();
    addresses = parseAddresses(reader, addressCount, header.requiredSigners, header.sigReadOnly, header.readOnly);
    configPriorityFee = parseConfig(reader, mask);
    instructions = parseV1Instructions(reader, instructionCount);
  } else {
    const addressCount = compactU16(reader);
    addresses = parseAddresses(reader, addressCount, header.requiredSigners, header.sigReadOnly, header.readOnly);
    blockhash = pubkey(reader);
    instructions = parseLegacyInstructions(reader);
    const lookups = parseLookups(reader, header.version);
    lookupRw = lookups.rw;
    lookupRo = lookups.ro;
    lookupTableCount = lookups.tableCount;
  }
  if (reader.remaining() !== 0) {
    throw new Error('trailing bytes');
  }
  return {
    version: header.version,
    requiredSigners: header.requiredSigners,
    addresses,
    blockhash,
    instructions,
    lookupRw,
    lookupRo,
    lookupTableCount,
    configPriorityFee,
  };
}

export function parseSolanaTransaction(serialized: Uint8Array): ParsedSolanaTransaction | null {
  try {
    return parseBody(serialized);
  } catch {
    return null;
  }
}

export function combinedSolanaAccounts(tx: ParsedSolanaTransaction): SolanaAccountRef[] {
  return [
    ...tx.addresses.map((pubkey) => ({ kind: 'static' as const, pubkey })),
    ...tx.lookupRw,
    ...tx.lookupRo,
  ];
}

export function checkSolanaSysvarAccounts(tx: ParsedSolanaTransaction): boolean {
  const combined = combinedSolanaAccounts(tx);
  for (const instruction of tx.instructions) {
    const program = tx.addresses[instruction.programIndex];
    if (!program) {
      return false;
    }
    const programId = base58.encode(program);
    const instructionId = readInstructionId(programId, instruction.data);
    const key = instructionId == null ? 'none' : String(instructionId);
    const slots = SYSVAR_SLOTS[programId]?.[key] ?? [];
    for (const slot of slots) {
      const account = instruction.accounts[slot.index];
      if (account == null) {
        continue;
      }
      const resolved = combined[account];
      if (!resolved) {
        return false;
      }
      if (resolved.kind !== 'static' || !same32(resolved.pubkey, SYSVAR_PUBKEYS[slot.name])) {
        return false;
      }
    }
  }
  return true;
}

function instructionIndexesValid(tx: ParsedSolanaTransaction): boolean {
  const combined = combinedSolanaAccounts(tx);
  for (const instruction of tx.instructions) {
    if (instruction.programIndex >= tx.addresses.length) {
      return false;
    }
    for (const account of instruction.accounts) {
      if (account >= combined.length) {
        return false;
      }
    }
  }
  return true;
}

/** Trezor `sign_tx.py`: parse failures and sysvar mismatches become DataError("Invalid transaction"). */
export function validateTrezorSolanaTransaction(serialized: Uint8Array): boolean {
  const parsed = parseSolanaTransaction(serialized);
  return parsed != null && instructionIndexesValid(parsed) && checkSolanaSysvarAccounts(parsed);
}

export function solanaSystemTransfers(tx: ParsedSolanaTransaction): { to: string; lamports: bigint }[] {
  const combined = combinedSolanaAccounts(tx);
  const transfers: { to: string; lamports: bigint }[] = [];
  for (const instruction of tx.instructions) {
    const program = tx.addresses[instruction.programIndex];
    if (!program || !program.every((byte) => byte === 0)) {
      continue;
    }
    if (instruction.data.length !== 12 || readInstructionId(SOLANA_SYSTEM_PROGRAM_ID, instruction.data) !== SYSTEM_TRANSFER) {
      continue;
    }
    const recipientIndex = instruction.accounts[1];
    if (recipientIndex == null) {
      continue;
    }
    const recipient = combined[recipientIndex];
    if (!recipient || recipient.kind !== 'static') {
      continue;
    }
    let lamports = 0n;
    for (let index = 0; index < 8; index += 1) {
      lamports |= BigInt(instruction.data[4 + index]!) << BigInt(8 * index);
    }
    transfers.push({ to: base58.encode(recipient.pubkey), lamports });
  }
  return transfers;
}

function u32le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = value;
  for (let index = 0; index < 8; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

const SYSTEM_PROGRAM = new Uint8Array(32);

export function encodeLegacySystemTransfer(input: {
  payer: Uint8Array;
  recipient: Uint8Array;
  lamports: bigint;
  blockhash?: Uint8Array;
}): Uint8Array {
  const blockhash = input.blockhash ?? new Uint8Array(32);
  const data = concatBytes(u32le(SYSTEM_TRANSFER), u64le(input.lamports));
  return concatBytes(
    Uint8Array.of(1, 0, 1, 3),
    input.payer,
    input.recipient,
    SYSTEM_PROGRAM,
    blockhash,
    Uint8Array.of(1, 2, 2, 0, 1, 12),
    data,
  );
}

export function encodeV1SystemTransfer(input: {
  payer: Uint8Array;
  recipient: Uint8Array;
  lamports: bigint;
  priorityFee: bigint;
  blockhash?: Uint8Array;
}): Uint8Array {
  const blockhash = input.blockhash ?? new Uint8Array(32);
  const data = concatBytes(u32le(SYSTEM_TRANSFER), u64le(input.lamports));
  return concatBytes(
    Uint8Array.of(0x81, 1, 0, 1),
    u32le(CONFIG_PRIORITY_FEE),
    blockhash,
    Uint8Array.of(1, 3),
    input.payer,
    input.recipient,
    SYSTEM_PROGRAM,
    u64le(input.priorityFee),
    Uint8Array.of(2, 2, 12, 0),
    Uint8Array.of(0, 1),
    data,
  );
}

export function encodeLegacyStakeInitialize(input: {
  stakeAccount: Uint8Array;
  sysvar: Uint8Array;
  lookups?: { table: Uint8Array; rw: number[] };
}): Uint8Array {
  const stakeProgram = base58.decode(SOLANA_STAKE_PROGRAM_ID);
  const lookups = input.lookups;
  if (lookups) {
    return concatBytes(
      Uint8Array.of(0x80, 1, 0, 1, 2),
      input.stakeAccount,
      stakeProgram,
      new Uint8Array(32),
      Uint8Array.of(1, 1, 2, 0, 2, 4, 0, 0, 0, 0, 1),
      lookups.table,
      Uint8Array.of(lookups.rw.length, ...lookups.rw, 0),
    );
  }
  return concatBytes(
    Uint8Array.of(1, 0, 1, 3),
    input.stakeAccount,
    input.sysvar,
    stakeProgram,
    new Uint8Array(32),
    Uint8Array.of(1, 2, 2, 0, 1, 4, 0, 0, 0, 0),
  );
}
