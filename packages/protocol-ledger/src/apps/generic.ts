import type { BackupKind, ChainPathId, ConfirmationPort, SigningDetail, SigningRequest } from '@cws/contracts';
import { base58 } from '@scure/base';
import { concatBytes, bytesToHex } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_CLA_NOT_SUPPORTED,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import {
  deriveEd25519PrivateKeyFromSeed,
  derivePrivateKeyFromSeed,
  ed25519PublicKey,
  publicKeyCompressed,
  seedFor,
  signEd25519,
  signSecp256k1Recoverable,
} from '../crypto';

export type FamilyContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
};

export type SuiBlocksSession = {
  ins: number;
  pendingHash: Uint8Array;
  remainingHashes: Uint8Array[];
  currentPayload: Uint8Array;
  payloads: Uint8Array[];
};

/**
 * Cardano SIGN_TX stream. v7 and v8 reuse P1 values for different stages, so
 * the protocol tag is the catalog major version at the time the stream starts.
 * `body` is the bytes uploaded so far. It is not the canonical CBOR transaction.
 */
export type CardanoTxWire = {
  protocol: 'v7' | 'v8';
  body: Uint8Array;
  hash?: Uint8Array;
};

export type FamilySession = {
  pendingSign?: { path: string; payload: Uint8Array };
  suiBlocks?: SuiBlocksSession;
  cardanoTx?: CardanoTxWire;
};

export type FamilySpec = {
  name: string;
  clas: number[];
  versionIns: number[];
  pubkeyIns: number[];
  signIns: number[];
  curve: 'ed25519' | 'secp256k1';
  versionBytes: () => Uint8Array;
  encodePubkey: (publicKey: Uint8Array, path: string) => Uint8Array;
  hashForSign?: (message: Uint8Array) => Uint8Array;
  /** Extra confirm copy for encodings that are not a full on-chain StateInit. */
  exportNote?: string;
  preview?: (message: Uint8Array) => string;
};

const FAMILY_PATHS: Record<string, readonly ChainPathId[]> = {
  Solana: ['sol-ledger', 'sol-phantom'],
  XRP: ['xrp'],
  Tron: ['trx'],
  Cosmos: ['atom'],
  TON: ['ton'],
  Aptos: ['apt'],
  Sui: ['sui'],
  Polkadot: ['dot'],
  Stellar: ['stellar'],
};

function familyPath(ctx: FamilyContext, spec: FamilySpec, path: string): string {
  const chains = FAMILY_PATHS[spec.name];
  if (!chains) {
    return path;
  }
  return ctx.confirmation.resolvePath?.(path, chains) ?? path;
}

function compactU16(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  if (offset >= bytes.length) {
    return null;
  }
  const b0 = bytes[offset]!;
  if (b0 < 0x80) {
    return { value: b0, next: offset + 1 };
  }
  if (offset + 1 >= bytes.length) {
    return null;
  }
  const b1 = bytes[offset + 1]!;
  if (b1 < 0x80) {
    return { value: (b0 & 0x7f) | (b1 << 7), next: offset + 2 };
  }
  if (offset + 2 >= bytes.length) {
    return null;
  }
  return { value: (b0 & 0x7f) | ((b1 & 0x7f) << 7) | (bytes[offset + 2]! << 14), next: offset + 3 };
}

const SOL_LAMPORTS = 1_000_000_000n;
const SYSTEM_TRANSFER = 2;

type SolanaTransfer = {
  to: string;
  lamports: bigint;
};

type SolanaPreview = {
  versioned: boolean;
  feePayer: string;
  instructionCount: number;
  lookupCount: number;
  transfers: SolanaTransfer[];
};

export function formatLamports(lamports: bigint): string {
  const whole = lamports / SOL_LAMPORTS;
  const fraction = lamports % SOL_LAMPORTS;
  const sol =
    fraction === 0n
      ? `${whole} SOL`
      : `${whole}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')} SOL`;
  return `${sol} (${lamports} lamports)`;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(bytes[offset + index]!) << BigInt(index * 8);
  }
  return value;
}

function isSystemProgram(key: Uint8Array): boolean {
  return key.length === 32 && key.every((byte) => byte === 0);
}

function parseSolanaMessage(message: Uint8Array): SolanaPreview | null {
  if (message.length < 4) {
    return null;
  }
  const versioned = (message[0]! & 0x80) !== 0;
  let offset = versioned ? 1 : 0;
  if (offset + 3 > message.length) {
    return null;
  }
  offset += 3;
  const accounts = compactU16(message, offset);
  if (!accounts || accounts.value < 1 || accounts.next + accounts.value * 32 > message.length) {
    return null;
  }
  const keys: Uint8Array[] = [];
  for (let index = 0; index < accounts.value; index += 1) {
    const start = accounts.next + index * 32;
    keys.push(message.subarray(start, start + 32));
  }
  const feePayer = base58.encode(keys[0]!);
  const afterBlockhash = accounts.next + accounts.value * 32 + 32;
  if (afterBlockhash > message.length) {
    return null;
  }
  const instructions = compactU16(message, afterBlockhash);
  if (!instructions) {
    return null;
  }
  const transfers: SolanaTransfer[] = [];
  let cursor = instructions.next;
  let intact = true;
  for (let index = 0; index < instructions.value; index += 1) {
    if (cursor >= message.length) {
      intact = false;
      break;
    }
    const programIndex = message[cursor]!;
    cursor += 1;
    const accountIndexes = compactU16(message, cursor);
    if (!accountIndexes || accountIndexes.next + accountIndexes.value > message.length) {
      intact = false;
      break;
    }
    const indexes = message.subarray(accountIndexes.next, accountIndexes.next + accountIndexes.value);
    cursor = accountIndexes.next + accountIndexes.value;
    const dataLen = compactU16(message, cursor);
    if (!dataLen || dataLen.next + dataLen.value > message.length) {
      intact = false;
      break;
    }
    const data = message.subarray(dataLen.next, dataLen.next + dataLen.value);
    cursor = dataLen.next + dataLen.value;
    const program = keys[programIndex];
    if (
      program &&
      isSystemProgram(program) &&
      data.length === 12 &&
      readU32LE(data, 0) === SYSTEM_TRANSFER &&
      indexes.length >= 2
    ) {
      const recipient = keys[indexes[1]!];
      if (recipient) {
        transfers.push({ to: base58.encode(recipient), lamports: readU64LE(data, 4) });
      }
    }
  }
  if (!intact) {
    return null;
  }
  const lookups = versioned ? compactU16(message, cursor) : null;
  return {
    versioned,
    feePayer,
    instructionCount: instructions.value,
    lookupCount: lookups?.value ?? 0,
    transfers,
  };
}

function formatSolanaPreview(parsed: SolanaPreview): string {
  const lookupText = parsed.lookupCount
    ? ` · ${parsed.lookupCount} lookup table${parsed.lookupCount === 1 ? '' : 's'}`
    : '';
  const transferText = parsed.transfers
    .map((transfer) => ` · to ${transfer.to} · ${formatLamports(transfer.lamports)}`)
    .join('');
  const count = parsed.instructionCount;
  return `${parsed.versioned ? 'v0 · ' : ''}fee payer ${parsed.feePayer} · ${count} instruction${count === 1 ? '' : 's'}${lookupText}${transferText}`;
}

export function previewSolanaMessage(message: Uint8Array): string {
  const parsed = parseSolanaMessage(message);
  return parsed ? formatSolanaPreview(parsed) : hexPreview(message);
}

export function solanaTransferDetail(path: string, message: Uint8Array): SigningDetail | null {
  const parsed = parseSolanaMessage(message);
  if (!parsed || parsed.transfers.length === 0) {
    return null;
  }
  return {
    style: 'raw-sign',
    headline: 'Sign Solana',
    note: formatSolanaPreview(parsed),
    fields: [
      { label: 'PATH', value: path, mono: true },
      ...parsed.transfers.flatMap((transfer) => [
        { label: 'TO', value: transfer.to, mono: true },
        { label: 'AMOUNT', value: formatLamports(transfer.lamports) },
      ]),
    ],
  };
}

function readProtoString(bytes: Uint8Array, field: number): string | null {
  let offset = 0;
  while (offset < bytes.length) {
    const key = bytes[offset]!;
    const number = key >> 3;
    const wire = key & 7;
    offset += 1;
    if (wire === 0) {
      while (offset < bytes.length && (bytes[offset]! & 0x80) !== 0) {
        offset += 1;
      }
      offset += 1;
      continue;
    }
    if (wire !== 2) {
      return null;
    }
    let length = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset]!;
      offset += 1;
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
    }
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    if (number === field) {
      try {
        return new TextDecoder().decode(value);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readProtoBytes(bytes: Uint8Array, field: number): Uint8Array | null {
  let offset = 0;
  while (offset < bytes.length) {
    const key = bytes[offset]!;
    const number = key >> 3;
    const wire = key & 7;
    offset += 1;
    if (wire === 0) {
      while (offset < bytes.length && (bytes[offset]! & 0x80) !== 0) {
        offset += 1;
      }
      offset += 1;
      continue;
    }
    if (wire !== 2) {
      return null;
    }
    let length = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset]!;
      offset += 1;
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
    }
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    if (number === field) {
      return value;
    }
  }
  return null;
}

function readProtoVarint(bytes: Uint8Array, field: number): bigint | null {
  let offset = 0;
  while (offset < bytes.length) {
    const key = bytes[offset]!;
    const number = key >> 3;
    const wire = key & 7;
    offset += 1;
    if (wire === 0) {
      let value = 0n;
      let shift = 0n;
      while (offset < bytes.length) {
        const byte = bytes[offset]!;
        offset += 1;
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
          break;
        }
        shift += 7n;
      }
      if (number === field) {
        return value;
      }
      continue;
    }
    if (wire !== 2) {
      return null;
    }
    let length = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset]!;
      offset += 1;
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
    }
    offset += length;
  }
  return null;
}

export function previewCosmosSignDoc(message: Uint8Array): string {
  try {
    const text = new TextDecoder().decode(message);
    const parsed = JSON.parse(text) as { chain_id?: unknown; chainId?: unknown; memo?: unknown; account_number?: unknown };
    const chain = typeof parsed.chain_id === 'string' ? parsed.chain_id : typeof parsed.chainId === 'string' ? parsed.chainId : '';
    const memo = typeof parsed.memo === 'string' ? parsed.memo : '';
    const account = parsed.account_number != null ? String(parsed.account_number) : '';
    const parts = [chain && `chain ${chain}`, account && `account ${account}`, memo && `memo ${memo}`].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' · ');
    }
  } catch {
    const chain = readProtoString(message, 3);
    const account = readProtoVarint(message, 4);
    const parts = [chain && `chain ${chain}`, account != null && `account ${account}`].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' · ');
    }
  }
  return hexPreview(message);
}

export function previewTronTransfer(message: Uint8Array): string {
  const to = readProtoBytes(message, 2);
  const amount = readProtoVarint(message, 3);
  if (to && to[0] === 0x41 && to.length === 21) {
    const encoded = tronBase58Safe(to);
    return amount != null ? `Transfer ${amount} to ${encoded}` : `Transfer to ${encoded}`;
  }
  for (let i = 0; i + 21 <= message.length; i++) {
    if (message[i] === 0x41) {
      return `Transfer ${message.length} bytes · T-address at ${i}`;
    }
  }
  return hexPreview(message);
}

function tronBase58Safe(payload: Uint8Array): string {
  try {
    return base58.encode(payload);
  } catch {
    return bytesToHex(payload);
  }
}

export function previewStellarEnvelope(message: Uint8Array): string {
  if (message.length < 4) {
    return hexPreview(message);
  }
  const type = (message[0]! << 24) | (message[1]! << 16) | (message[2]! << 8) | message[3]!;
  const names: Record<number, string> = { 0: 'tx v0', 2: 'tx', 4: 'tx fee-bump' };
  return `Stellar ${names[type] ?? `envelope ${type}`} · ${message.length} bytes`;
}

export function previewTezosOperation(message: Uint8Array): string {
  const tag = message[0];
  if (tag === 0x6c && message.length >= 22) {
    const dest = bytesToHex(message.subarray(1, 22));
    return `Tezos transaction · ${dest.slice(0, 16)}`;
  }
  if (tag === 0x6b) {
    return 'Tezos reveal';
  }
  return hexPreview(message);
}

function hexPreview(message: Uint8Array): string {
  return `0x${bytesToHex(message).slice(0, 96)}`;
}

function preview(message: Uint8Array, spec: FamilySpec): string {
  return spec.preview?.(message) ?? hexPreview(message);
}

export async function handleFamilyApdu(
  apdu: Apdu,
  spec: FamilySpec,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array | null> {
  if (!spec.clas.includes(apdu.cla)) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (spec.versionIns.includes(apdu.ins)) {
    return encodeResponse(spec.versionBytes(), SW_OK);
  }
  if (spec.pubkeyIns.includes(apdu.ins)) {
    return exportKey(apdu, spec, ctx);
  }
  if (spec.signIns.includes(apdu.ins)) {
    return signPayload(apdu, spec, ctx, session);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}

async function exportKey(apdu: Apdu, spec: FamilySpec, ctx: FamilyContext): Promise<Uint8Array> {
  let path: string;
  try {
    path = familyPath(ctx, spec, parseBip32Path(apdu.data).path);
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  if (apdu.p1 !== 0x00) {
    const ok = await ctx.confirmation.confirm({
      brand: 'ledger',
      kind: 'address',
      title: `Export ${spec.name} key`,
      path,
      message: spec.exportNote
        ? `Export ${spec.name} public key\n${path}\n${spec.exportNote}`
        : `Export ${spec.name} public key\n${path}`,
      rawPayload: apdu.data,
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const publicKey =
    spec.curve === 'ed25519'
      ? ed25519PublicKey(deriveEd25519PrivateKeyFromSeed(seed, path))
      : publicKeyCompressed(derivePrivateKeyFromSeed(seed, path));
  return encodeResponse(spec.encodePubkey(publicKey, path), SW_OK);
}

async function signPayload(
  apdu: Apdu,
  spec: FamilySpec,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array | null> {
  const hasMore = (apdu.p2 & 0x02) !== 0;
  if (!session.pendingSign || apdu.p1 === 0x00) {
    let path: string;
    let rest: Uint8Array;
    try {
      const parsed = parseBip32Path(apdu.data);
      path = familyPath(ctx, spec, parsed.path);
      rest = parsed.rest;
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
    }
    session.pendingSign = { path, payload: rest };
  } else {
    session.pendingSign.payload = concatBytes(session.pendingSign.payload, apdu.data);
  }
  if (hasMore) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const pending = session.pendingSign;
  session.pendingSign = undefined;
  if (!pending) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  if (pending.payload.length === 0) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const summary = preview(pending.payload, spec);
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: `Sign ${spec.name}`,
    path: pending.path,
    message: `Sign ${spec.name}\n${pending.path}\n${summary}`,
    rawPayload: pending.payload,
    detail: spec.name === 'Solana' ? solanaTransferDetail(pending.path, pending.payload) ?? undefined : undefined,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const message = spec.hashForSign ? spec.hashForSign(pending.payload) : pending.payload;
  const signature =
    spec.curve === 'ed25519'
      ? signEd25519(deriveEd25519PrivateKeyFromSeed(seed, pending.path), message)
      : signSecp256k1Recoverable(derivePrivateKeyFromSeed(seed, pending.path), message);
  return encodeResponse(signature, SW_OK);
}

export function versionTriple(version: string): Uint8Array {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(major & 0xff, minor & 0xff, patch & 0xff);
}

export function lengthPrefixed(data: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(data.length), data);
}
