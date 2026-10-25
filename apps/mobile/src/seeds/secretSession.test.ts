import { describe, expect, it } from 'vitest';
import { entropyFromMnemonic, passphraseBytes, seedFingerprint, toBip32Seed } from '@cws/sdk';
import { SecretSession } from './secretSession';

const FOUNDATION = 'test test test test test test test test test test test junk';

describe('SecretSession', () => {
  it('fingerprints the empty-passphrase seed on load', () => {
    const session = new SecretSession();
    const entropy = entropyFromMnemonic(FOUNDATION);
    session.load(entropy, 'bip39');
    expect(session.fingerprint).toBe(seedFingerprint(toBip32Seed(entropy, 'bip39', '')));
    expect(session.passphraseApplied).toBe(false);
  });

  it('changes the fingerprint when a passphrase is applied and wipes the input', () => {
    const session = new SecretSession();
    session.load(entropyFromMnemonic(FOUNDATION), 'bip39');
    const empty = session.fingerprint;
    const input = passphraseBytes('TREZOR');
    session.applyPassphrase(input);
    expect(Array.from(input).every((byte) => byte === 0)).toBe(true);
    expect(session.passphraseApplied).toBe(true);
    expect(session.fingerprint).toBe(
      seedFingerprint(toBip32Seed(entropyFromMnemonic(FOUNDATION), 'bip39', 'TREZOR')),
    );
    expect(session.fingerprint).not.toBe(empty);
  });

  it('zeros cached buffers on wipe', () => {
    const session = new SecretSession();
    session.load(entropyFromMnemonic(FOUNDATION), 'bip39');
    const seed = session.copySeed();
    expect(seed?.some((byte) => byte !== 0)).toBe(true);
    session.wipe();
    expect(session.fingerprint).toBeNull();
    expect(session.copySeed()).toBeUndefined();
  });
});
