import { concatBytes, encodeAscii, readU32BE } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  type Apdu,
} from '../apdu';
import {
  derivePrivateKey,
  ethereumAddressFromPrivateKey,
  publicKeyUncompressed,
  signPersonalMessage,
} from '../crypto';
import type { BackupKind, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { LEDGER_INSTALLED_APPS } from '@cws/contracts';

function ethAppVersionBytes(): Uint8Array {
  const version = LEDGER_INSTALLED_APPS.find((app) => app.id === 'ethereum')?.version ?? '1.23.0';
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(0x00, major & 0xff, minor & 0xff, patch & 0xff);
}

export const ETH_APP_VERSION = ethAppVersionBytes();

export type EthSession = {
  pendingPersonal?: {
    path: string;
    expected: number;
    message: Uint8Array;
  };
};

export type EthContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  session: EthSession;
};

export async function handleEthereumApdu(apdu: Apdu, ctx: EthContext): Promise<Uint8Array | null> {
  switch (apdu.ins) {
    case 0x06:
      return encodeResponse(ETH_APP_VERSION, SW_OK);
    case 0x02:
      return handleGetAddress(apdu, ctx);
    case 0x08:
      return handlePersonalSign(apdu, ctx);
    case 0x04:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

async function handleGetAddress(apdu: Apdu, ctx: EthContext): Promise<Uint8Array> {
  const { path } = parseBip32Path(apdu.data);
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'address',
    title: 'Export Ethereum address',
    path,
    message: `Export Ethereum address\n${path}`,
    rawPayload: apdu.data,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  const privateKey = derivePrivateKey(ctx.entropy, path, passphrase, ctx.backup);
  const pub = publicKeyUncompressed(privateKey);
  const address = ethereumAddressFromPrivateKey(privateKey);
  const addressBytes = encodeAscii(address);
  const body = concatBytes(
    Uint8Array.of(pub.length),
    pub,
    Uint8Array.of(addressBytes.length),
    addressBytes,
  );
  return encodeResponse(body, SW_OK);
}

async function handlePersonalSign(apdu: Apdu, ctx: EthContext): Promise<Uint8Array | null> {
  if (apdu.p1 === 0x00) {
    const { path, rest } = parseBip32Path(apdu.data);
    if (rest.length < 4) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const expected = readU32BE(rest, 0);
    ctx.session.pendingPersonal = {
      path,
      expected,
      message: rest.slice(4),
    };
  } else if (apdu.p1 === 0x80) {
    if (!ctx.session.pendingPersonal) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    ctx.session.pendingPersonal.message = concatBytes(
      ctx.session.pendingPersonal.message,
      apdu.data,
    );
  } else {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }

  const pending = ctx.session.pendingPersonal;
  if (!pending || pending.message.length < pending.expected) {
    return null;
  }

  const message = pending.message.slice(0, pending.expected);
  ctx.session.pendingPersonal = undefined;
  const preview = previewMessage(message);
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign message',
    path: pending.path,
    message: `Sign personal message\n${pending.path}\n${preview}`,
    rawPayload: message,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  const privateKey = derivePrivateKey(ctx.entropy, pending.path, passphrase, ctx.backup);
  const signature = signPersonalMessage(privateKey, message);
  return encodeResponse(signature, SW_OK);
}

function previewMessage(message: Uint8Array): string {
  try {
    const text = new TextDecoder().decode(message);
    if (/^[\x20-\x7e\s]+$/.test(text)) {
      return text.length > 180 ? `${text.slice(0, 180)}…` : text;
    }
  } catch {
    // binary payload
  }
  return `0x${Array.from(message, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 96)}`;
}
