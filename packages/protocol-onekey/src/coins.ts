import type { BackupKind, ChainPathId } from '@cws/contracts';
import { base58 } from '@scure/base';
import {
  aptosAuthKey,
  cardanoEnterprise,
  cosmosBech32,
  deriveIcarus,
  ss58Encode,
  suiAddress,
  tonBounceable,
  tronBase58,
  xrpClassic,
} from '@cws/protocol-ledger';
import { bytesToHex } from './bytes';
import { MessageType } from './messages';

export type CoinCurve = 'secp256k1' | 'ed25519' | 'icarus';

export type CoinOp = {
  request: number;
  reply: number;
  kind: 'address' | 'sign';
  curve: CoinCurve;
  chains: readonly ChainPathId[];
  title: string;
  bytesField?: number;
  addressOf?: (publicKey: Uint8Array) => string;
};

function hexAddress(publicKey: Uint8Array): string {
  return bytesToHex(publicKey);
}

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
    request: MessageType.SolanaSignTx,
    reply: MessageType.SolanaSignedTx,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['sol-ledger', 'sol-phantom'],
    title: 'Sign Solana transaction',
  },
  {
    request: MessageType.SolanaSignOffChainMessage,
    reply: MessageType.SolanaMessageSignature,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['sol-ledger', 'sol-phantom'],
    title: 'Sign Solana message',
  },
  {
    request: MessageType.NearGetAddress,
    reply: MessageType.NearAddress,
    kind: 'address',
    curve: 'ed25519',
    chains: ['near'],
    title: 'Export NEAR address',
    addressOf: hexAddress,
  },
  {
    request: MessageType.NearSignTx,
    reply: MessageType.NearSignedTx,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['near'],
    title: 'Sign NEAR transaction',
  },
  {
    request: MessageType.AptosGetAddress,
    reply: MessageType.AptosAddress,
    kind: 'address',
    curve: 'ed25519',
    chains: ['apt'],
    title: 'Export Aptos address',
    addressOf: aptosAuthKey,
  },
  {
    request: MessageType.AptosSignTx,
    reply: MessageType.AptosSignedTx,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['apt'],
    title: 'Sign Aptos transaction',
  },
  {
    request: MessageType.AptosSignMessage,
    reply: MessageType.AptosMessageSignature,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['apt'],
    title: 'Sign Aptos message',
  },
  {
    request: MessageType.SuiGetAddress,
    reply: MessageType.SuiAddress,
    kind: 'address',
    curve: 'ed25519',
    chains: ['sui'],
    title: 'Export Sui address',
    addressOf: suiAddress,
  },
  {
    request: MessageType.SuiSignTx,
    reply: MessageType.SuiSignedTx,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['sui'],
    title: 'Sign Sui transaction',
  },
  {
    request: MessageType.SuiSignMessage,
    reply: MessageType.SuiMessageSignature,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['sui'],
    title: 'Sign Sui message',
  },
  {
    request: MessageType.TonGetAddress,
    reply: MessageType.TonAddress,
    kind: 'address',
    curve: 'ed25519',
    chains: ['ton'],
    title: 'Export TON address',
    addressOf: tonBounceable,
  },
  {
    request: MessageType.TonSignMessage,
    reply: MessageType.TonSignedMessage,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['ton'],
    title: 'Sign TON message',
  },
  {
    request: MessageType.PolkadotGetAddress,
    reply: MessageType.PolkadotAddress,
    kind: 'address',
    curve: 'ed25519',
    chains: ['dot'],
    title: 'Export Polkadot address',
    addressOf: (pub) => ss58Encode(pub, 0),
  },
  {
    request: MessageType.PolkadotSignTx,
    reply: MessageType.PolkadotSignedTx,
    kind: 'sign',
    curve: 'ed25519',
    chains: ['dot'],
    title: 'Sign Polkadot transaction',
  },
  {
    request: MessageType.TronGetAddress,
    reply: MessageType.TronAddress,
    kind: 'address',
    curve: 'secp256k1',
    chains: ['trx'],
    title: 'Export Tron address',
    addressOf: tronBase58,
  },
  {
    request: MessageType.TronSignTx,
    reply: MessageType.TronSignedTx,
    kind: 'sign',
    curve: 'secp256k1',
    chains: ['trx'],
    title: 'Sign Tron transaction',
  },
  {
    request: MessageType.TronSignMessage,
    reply: MessageType.TronMessageSignature,
    kind: 'sign',
    curve: 'secp256k1',
    chains: ['trx'],
    title: 'Sign Tron message',
  },
  {
    request: MessageType.CosmosGetAddress,
    reply: MessageType.CosmosAddress,
    kind: 'address',
    curve: 'secp256k1',
    chains: ['atom'],
    title: 'Export Cosmos address',
    addressOf: (pub) => cosmosBech32(pub),
  },
  {
    request: MessageType.CosmosSignTx,
    reply: MessageType.CosmosSignedTx,
    kind: 'sign',
    curve: 'secp256k1',
    chains: ['atom'],
    title: 'Sign Cosmos transaction',
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
  {
    request: MessageType.CardanoGetAddress,
    reply: MessageType.CardanoAddress,
    kind: 'address',
    curve: 'icarus',
    chains: ['ada'],
    title: 'Export Cardano address',
    addressOf: cardanoEnterprise,
  },
];

export const COIN_BY_REQUEST = new Map(COIN_OPS.map((op) => [op.request, op]));

export function icarusAddress(
  entropy: Uint8Array,
  path: string,
  passphrase: string | undefined,
  backup: BackupKind,
): string {
  const node = deriveIcarus(entropy, path, passphrase, backup);
  return cardanoEnterprise(node.publicKey);
}
