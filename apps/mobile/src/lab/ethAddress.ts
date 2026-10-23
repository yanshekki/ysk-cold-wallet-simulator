import { derivePrivateKey, ethereumAddressFromPrivateKey } from '@cws/protocol-ledger';

export const DEFAULT_ETH_PATH = "m/44'/60'/0'/0/0";

export function derivedEthAddress(entropy: Uint8Array, passphrase?: string): string {
  const key = derivePrivateKey(entropy, DEFAULT_ETH_PATH, passphrase);
  const address = ethereumAddressFromPrivateKey(key);
  return address.startsWith('0x') ? address : `0x${address}`;
}
