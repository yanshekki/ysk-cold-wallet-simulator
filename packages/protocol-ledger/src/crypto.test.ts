import { describe, expect, it } from 'vitest';
import { mnemonicToEntropy, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import type { ConfirmationPort } from '@cws/contracts';
import { derivePrivateKey, derivePrivateKeyFromSeed, ethereumAddressFromPrivateKey, seedFor } from './crypto';

const FOUNDATION = 'test test test test test test test test test test test junk';
const PATH = "m/44'/60'/0'/0/0";

describe('seedFor', () => {
  const entropy = mnemonicToEntropy(FOUNDATION, wordlist);

  it('falls back to getPassphrase when getSeed is absent', async () => {
    const confirmation: ConfirmationPort = {
      async confirm() {
        return true;
      },
      async getPassphrase() {
        return 'TREZOR';
      },
    };
    const seed = await seedFor(confirmation, 'slot', entropy, 'bip39');
    expect(ethereumAddressFromPrivateKey(derivePrivateKeyFromSeed(seed, PATH))).toBe(
      ethereumAddressFromPrivateKey(derivePrivateKey(entropy, PATH, 'TREZOR')),
    );
  });

  it('prefers getSeed over getPassphrase', async () => {
    const confirmation: ConfirmationPort = {
      async confirm() {
        return true;
      },
      async getPassphrase() {
        return 'WRONG';
      },
      async getSeed() {
        return mnemonicToSeedSync(FOUNDATION, 'TREZOR');
      },
    };
    const seed = await seedFor(confirmation, 'slot', entropy, 'bip39');
    expect(ethereumAddressFromPrivateKey(derivePrivateKeyFromSeed(seed, PATH))).toBe(
      ethereumAddressFromPrivateKey(derivePrivateKey(entropy, PATH, 'TREZOR')),
    );
    expect(ethereumAddressFromPrivateKey(derivePrivateKeyFromSeed(seed, PATH))).not.toBe(
      ethereumAddressFromPrivateKey(derivePrivateKey(entropy, PATH, 'WRONG')),
    );
  });
});
