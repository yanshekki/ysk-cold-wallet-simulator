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
});
