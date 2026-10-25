import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import { mnemonicToSeedSync } from '@scure/bip39';
import { DEFAULT_CHAIN_PATHS, type SeedSlot } from '@cws/contracts';
import { mnemonicFromEntropy } from '@cws/sdk';
import { slip10Ed25519 } from './slip10';

const TREZU = 'https://api.trezu.app/api/user/create';
const FASTNEAR = 'https://api.fastnear.com';
const RPC = 'https://rpc.mainnet.near.org';

export type NearStatus = {
  accountId: string;
  publicKey: string;
  exists: boolean;
  created?: boolean;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function nearKeysFromEntropy(
  entropy: Uint8Array,
  path = DEFAULT_CHAIN_PATHS.near,
  passphrase = '',
  backup: SeedSlot['backup'] = 'bip39',
): { accountId: string; publicKey: string } {
  const seed =
    backup === 'slip39' ? entropy : mnemonicToSeedSync(mnemonicFromEntropy(entropy), passphrase);
  const secret = slip10Ed25519(seed, path);
  const publicKey = ed25519.getPublicKey(secret);
  return {
    accountId: bytesToHex(publicKey),
    publicKey: `ed25519:${base58.encode(publicKey)}`,
  };
}

export async function lookupNearAccount(accountId: string, publicKey: string): Promise<boolean> {
  try {
    const fast = await fetch(`${FASTNEAR}/v0/public_key/${encodeURIComponent(publicKey)}`);
    if (fast.ok) {
      const body: unknown = await fast.json();
      if (Array.isArray(body) && body.length > 0) {
        return true;
      }
      if (body && typeof body === 'object' && 'account_id' in body) {
        return true;
      }
    }
  } catch {
    // fall through to RPC
  }
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cws',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  const payload = (await response.json()) as { result?: unknown; error?: unknown };
  return Boolean(payload.result) && !payload.error;
}

export async function sponsorNearAccount(accountId: string, publicKey: string): Promise<boolean> {
  const response = await fetch(TREZU, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, publicKey }),
  });
  if (!response.ok) {
    throw new Error(`Trezu HTTP ${response.status}`);
  }
  const body = (await response.json()) as { created?: boolean; error?: string };
  if (body.error) {
    throw new Error(body.error);
  }
  return Boolean(body.created);
}

export async function ensureNearAccount(
  entropy: Uint8Array,
  slot: SeedSlot,
  passphrase = '',
  sponsorIfMissing = true,
): Promise<NearStatus> {
  const path = slot.nearPath ?? slot.paths?.near ?? DEFAULT_CHAIN_PATHS.near;
  const keys = nearKeysFromEntropy(entropy, path, passphrase, slot.backup);
  const exists = await lookupNearAccount(keys.accountId, keys.publicKey);
  if (exists) {
    return { ...keys, exists: true, created: false };
  }
  if (!sponsorIfMissing) {
    return { ...keys, exists: false };
  }
  const created = await sponsorNearAccount(keys.accountId, keys.publicKey);
  return { ...keys, exists: created, created };
}
