import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

describe('secret screenshot warning', () => {
  it('wires the vault, import, and generate screens to the warning toast', () => {
    for (const file of ['app/(app)/vault.tsx', 'app/seeds/import.tsx', 'app/seeds/new.tsx']) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source, file).toContain('useSecretScreenshotWarning()');
      expect(source, file).not.toContain('useSecretScreen(() => undefined)');
    }
  });

  it('turns system copy off on seed entry and masked passphrase fields', () => {
    for (const file of ['app/seeds/import.tsx', 'app/seeds/new.tsx', 'app/(app)/index.tsx']) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source, file).toContain('secretInputProps');
    }
    const imported = readFileSync(path.join(root, 'app/seeds/import.tsx'), 'utf8');
    expect(imported).not.toContain('item.ok ? item.word');
    expect(imported).not.toContain('copyText(');
  });

  it('does not offer a copy button on the phrase or share grids', () => {
    for (const file of ['app/(app)/vault.tsx', 'app/seeds/new.tsx']) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source, file).not.toContain('copyPhrase');
      expect(source, file).not.toContain('copyShare');
      expect(source, file).not.toContain("t('generate.copy')");
    }
  });

  it('arms capture for the passphrase sheet, seed QR, and seed-export confirm', () => {
    const device = readFileSync(path.join(root, 'app/(app)/index.tsx'), 'utf8');
    const signing = readFileSync(path.join(root, 'src/signing/HostedSigningModal.tsx'), 'utf8');
    expect(device).toContain('SecretScreenshotBoundary');
    expect(device).toContain("qr?.format === 'crypto-seed'");
    expect(signing).toContain("pending?.kind === 'export-seed'");
    expect(signing).toContain('SecretScreenshotBoundary');
  });
});
