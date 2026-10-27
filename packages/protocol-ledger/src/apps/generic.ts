import type { BackupKind, ChainPathId, ConfirmationPort, SigningRequest } from '@cws/contracts';
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

export type FamilySession = {
  pendingSign?: { path: string; payload: Uint8Array };
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

export function previewSolanaMessage(message: Uint8Array): string {
  if (message.length < 4) {
    return hexPreview(message);
  }
  const versioned = (message[0]! & 0x80) !== 0;
  let offset = versioned ? 1 : 0;
  if (offset + 3 > message.length) {
    return hexPreview(message);
  }
  offset += 3;
  const accounts = compactU16(message, offset);
  if (!accounts || accounts.next + 32 > message.length) {
    return hexPreview(message);
  }
  const feePayer = base58.encode(message.subarray(accounts.next, accounts.next + 32));
  const afterAccounts = accounts.next + accounts.value * 32;
  const afterBlockhash = afterAccounts + 32;
  const instructions = compactU16(message, afterBlockhash);
  if (!instructions) {
    return hexPreview(message);
  }
  let cursor = instructions.next;
  for (let index = 0; index < instructions.value; index += 1) {
    cursor += 1;
    const accountsLen = compactU16(message, cursor);
    if (!accountsLen) {
      break;
    }
    cursor = accountsLen.next + accountsLen.value;
    const dataLen = compactU16(message, cursor);
    if (!dataLen) {
      break;
    }
    cursor = dataLen.next + dataLen.value;
  }
  const lookups = versioned ? compactU16(message, cursor) : null;
  const count = instructions.value;
  const lookupText = lookups && lookups.value ? ` · ${lookups.value} lookup table${lookups.value === 1 ? '' : 's'}` : '';
  return `${versioned ? 'v0 · ' : ''}fee payer ${feePayer} · ${count} instruction${count === 1 ? '' : 's'}${lookupText}`;
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
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: `Sign ${spec.name}`,
    path: pending.path,
    message: `Sign ${spec.name}\n${pending.path}\n${preview(pending.payload, spec)}`,
    rawPayload: pending.payload,
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
