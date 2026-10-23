import { bech32, base58check as createBase58check } from '@scure/base';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import type { BackupKind, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { LEDGER_INSTALLED_APPS } from '@cws/contracts';
import { concatBytes, encodeAscii } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { deriveHdNode, type HdNode } from '../crypto';
import { encodeAppAndVersion } from './dashboard';

export const BITCOIN_APP_VERSION =
  LEDGER_INSTALLED_APPS.find((app) => app.id === 'bitcoin')?.version ?? '2.4.2';

const b58c = createBase58check(sha256);

export type BtcContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
};

export function getBitcoinAppAndVersion(): Uint8Array {
  return encodeAppAndVersion('Bitcoin', BITCOIN_APP_VERSION);
}

export async function handleBitcoinApdu(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  switch (apdu.ins) {
    case 0x40:
      return handleGetWalletPublicKey(apdu, ctx);
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

export function bitcoinAddressFor(node: HdNode, path: string, p2: number): string {
  if (p2 === 0x02 || path.startsWith("m/84'/")) {
    return bitcoinP2wpkh(node.publicKey);
  }
  if (p2 === 0x01 || path.startsWith("m/49'/")) {
    return bitcoinP2shP2wpkh(node.publicKey);
  }
  return bitcoinP2pkh(node.publicKey);
}

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

export function bitcoinP2pkh(publicKey: Uint8Array): string {
  return b58c.encode(concatBytes(Uint8Array.of(0x00), hash160(publicKey)));
}

export function bitcoinP2shP2wpkh(publicKey: Uint8Array): string {
  const redeem = concatBytes(Uint8Array.of(0x00, 0x14), hash160(publicKey));
  return b58c.encode(concatBytes(Uint8Array.of(0x05), hash160(redeem)));
}

export function bitcoinP2wpkh(publicKey: Uint8Array): string {
  const words = bech32.toWords(hash160(publicKey));
  return bech32.encode('bc', [0, ...words]);
}

async function handleGetWalletPublicKey(apdu: Apdu, ctx: BtcContext): Promise<Uint8Array> {
  const { path } = parseBip32Path(apdu.data);
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'address',
    title: 'Export Bitcoin key',
    path,
    message: `Export Bitcoin public key\n${path}`,
    rawPayload: apdu.data,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  const node = deriveHdNode(ctx.entropy, path, passphrase, ctx.backup);
  const address = bitcoinAddressFor(node, path, apdu.p2);
  const addressBytes = encodeAscii(address);
  const body = concatBytes(
    Uint8Array.of(node.publicKey.length),
    node.publicKey,
    Uint8Array.of(addressBytes.length),
    addressBytes,
    node.chainCode,
  );
  return encodeResponse(body, SW_OK);
}
