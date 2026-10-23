import { mnemonicToSeedSync } from '@scure/bip39';
import type { BackupKind } from '@cws/contracts';
import { mnemonicFromEntropy } from './entropy';

export function toBip32Seed(
  secret: Uint8Array,
  backup: BackupKind = 'bip39',
  passphrase = '',
): Uint8Array {
  if (backup === 'slip39') {
    return secret;
  }
  return mnemonicToSeedSync(mnemonicFromEntropy(secret), passphrase);
}
