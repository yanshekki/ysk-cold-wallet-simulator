import type { BackupKind } from '@cws/contracts';
import { icarusRootFromEntropy } from '@cws/protocol-ledger';
import { passphraseBytes, seedFingerprint, toBip32Seed, wipeBytes } from '@cws/sdk';

export class SecretSession {
  private entropy: Uint8Array | null = null;
  private seed: Uint8Array | null = null;
  private icarusRoot: Uint8Array | null = null;
  private backup: BackupKind = 'bip39';
  passphraseApplied = false;

  get fingerprint(): string | null {
    return this.seed ? seedFingerprint(this.seed) : null;
  }

  copySeed(): Uint8Array | undefined {
    return this.seed ? this.seed.slice() : undefined;
  }

  copyIcarusRoot(): Uint8Array | undefined {
    return this.icarusRoot ? this.icarusRoot.slice() : undefined;
  }

  load(entropy: Uint8Array, backup: BackupKind = 'bip39'): void {
    this.wipe();
    this.backup = backup;
    this.entropy = entropy.slice();
    this.materialize(new Uint8Array());
    this.passphraseApplied = false;
  }

  applyPassphrase(bytes: Uint8Array): void {
    if (!this.entropy) {
      throw new Error('secret session is empty');
    }
    const applied = bytes.length > 0;
    this.materialize(bytes);
    wipeBytes(bytes);
    this.passphraseApplied = applied;
  }

  applyPassphraseText(value: string): void {
    this.applyPassphrase(passphraseBytes(value));
  }

  clearPassphrase(): void {
    if (!this.entropy) {
      return;
    }
    this.materialize(new Uint8Array());
    this.passphraseApplied = false;
  }

  wipe(): void {
    wipeBytes(this.entropy, this.seed, this.icarusRoot);
    this.entropy = null;
    this.seed = null;
    this.icarusRoot = null;
    this.passphraseApplied = false;
    this.backup = 'bip39';
  }

  private materialize(pass: Uint8Array): void {
    if (!this.entropy) {
      throw new Error('secret session is empty');
    }
    wipeBytes(this.seed, this.icarusRoot);
    const passphrase = new TextDecoder().decode(pass);
    this.seed = toBip32Seed(this.entropy, this.backup, passphrase);
    this.icarusRoot = this.backup === 'bip39' ? icarusRootFromEntropy(this.entropy, passphrase) : null;
  }
}
