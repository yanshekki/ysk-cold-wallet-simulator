import type { BackupKind, ChainPathId } from '@cws/contracts';
import { base58 } from '@scure/base';
import { cardanoEnterprise, deriveIcarus, xrpClassic } from '@cws/protocol-ledger';
import { MessageType } from './messages';

export type CoinCurve = 'secp256k1' | 'ed25519' | 'icarus';

export type CoinOp = {
  request: number;
  reply: number;
  kind: 'address' | 'sign' | 'pubkey';
  curve: CoinCurve;
  chains: readonly ChainPathId[];
  title: string;
  addressOf?: (publicKey: Uint8Array) => string;
};

export const COIN_OPS: CoinOp[] = [
  {
    request: MessageType.SolanaGetAddress,
    reply: MessageType.SolanaAddress,
    kind: 'address',
    curve: 'ed25519',
    chains: ['sol-ledger', 'sol-phantom'],
    title: 'Export Solana address',
    addressOf: (pub) => base58.encode(pub),
  },
  {
    request: MessageType.SolanaGetPublicKey,
    reply: MessageType.SolanaPublicKey,
    kind: 'pubkey',
    curve: 'ed25519',
    chains: ['sol-ledger', 'sol-phantom'],
    title: 'Export Solana public key',
  },
  {
    request: MessageType.SolanaSignTx,
    reply: MessageType.SolanaTxSignature,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['sol-ledger', 'sol-phantom'],
    title: 'Sign Solana transaction',
  },
  {
    request: MessageType.CardanoGetAddress,
    reply: MessageType.CardanoAddress,
    kind: 'address',
    curve: 'icarus',
    chains: ['ada'],
    title: 'Export Cardano address',
    addressOf: cardanoEnterprise,
  },
  {
    request: MessageType.RippleGetAddress,
    reply: MessageType.RippleAddress,
    kind: 'address',
    curve: 'secp256k1',
    chains: ['xrp'],
    title: 'Export XRP address',
    addressOf: xrpClassic,
  },
  {
    request: MessageType.RippleSignTx,
    reply: MessageType.RippleSignedTx,
    kind: 'sign',
    curve: 'secp256k1',
    chains: ['xrp'],
    title: 'Sign XRP transaction',
  },
];

export const COIN_BY_REQUEST = new Map(COIN_OPS.map((op) => [op.request, op]));

export function icarusAddress(
  entropy: Uint8Array,
  path: string,
  passphrase: string | undefined,
  backup: BackupKind,
  root?: Uint8Array,
): string {
  return cardanoEnterprise(deriveIcarus(entropy, path, passphrase, backup, root).publicKey);
}
