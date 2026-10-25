import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import { mnemonicToSeedSync } from '@scure/bip39';
import { DEFAULT_CHAIN_PATHS, type SeedSlot } from '@cws/contracts';
import { mnemonicFromEntropy } from '@cws/sdk';
import { slip10Ed25519 } from './slip10';

export type NearStatus = {
  accountId: string;
  publicKey: string;
  exists: boolean;
  created?: boolean;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function nearKeysFromSeed(
  seed: Uint8Array,
  path = DEFAULT_CHAIN_PATHS.near,
): { accountId: string; publicKey: string } {
  const secret = slip10Ed25519(seed, path);
  const publicKey = ed25519.getPublicKey(secret);
  return {
    accountId: bytesToHex(publicKey),
    publicKey: `ed25519:${base58.encode(publicKey)}`,
  };
}

export function nearKeysFromEntropy(
  entropy: Uint8Array,
  path = DEFAULT_CHAIN_PATHS.near,
  passphrase = '',
  backup: SeedSlot['backup'] = 'bip39',
): { accountId: string; publicKey: string } {
  const seed =
    backup === 'slip39' ? entropy : mnemonicToSeedSync(mnemonicFromEntropy(entropy), passphrase);
  return nearKeysFromSeed(seed, path);
}

export function ensureNearAccount(seed: Uint8Array, slot: SeedSlot): NearStatus {
  const path = slot.nearPath ?? slot.paths?.near ?? DEFAULT_CHAIN_PATHS.near;
  return { ...nearKeysFromSeed(seed, path), exists: false, created: false };
}
