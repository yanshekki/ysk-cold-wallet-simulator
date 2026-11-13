import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function screen(rel: string): string {
  return readFileSync(path.join(import.meta.dirname, rel), 'utf8');
}

function firstIndexAfter(source: string, startNeedle: string, needle: string): number {
  const start = source.indexOf(startNeedle);
  expect(start, startNeedle).toBeGreaterThan(-1);
  const from = source.slice(start);
  const index = from.indexOf(needle);
  expect(index, `${needle} after ${startNeedle}`).toBeGreaterThan(-1);
  return start + index;
}

describe('wallet prep screen wiring', () => {
  it('shows the passphrase overlay inside the same Sheet Modal before OS auth', () => {
    const source = screen('../../app/(app)/index.tsx');
    expect(source).toContain('passPreparing ? <LoadingOverlay visible label={t(\'common.preparingWallet\')} />');
    expect(source).toContain('work: (signal) => applySessionPassphrase(passDraft, { signal })');
    const show = source.indexOf('show: () => setPassPreparing(true)');
    const apply = source.indexOf('applySessionPassphrase(passDraft, { signal })');
    expect(show).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(show);
  });

  it('asks for OS reauth only after preparing-wallet overlay on generate, import, and backup', () => {
    const generate = screen('../../app/seeds/new.tsx');
    const generateLoading = firstIndexAfter(generate, 'const confirm = async', "t('common.preparingWallet')");
    const generateAuth = firstIndexAfter(generate, 'const confirm = async', 'reauthBeforeReveal');
    expect(generateAuth).toBeGreaterThan(generateLoading);

    const imported = screen('../../app/seeds/import.tsx');
    const importLoading = firstIndexAfter(imported, 'const onImport = async', "t('common.preparingWallet')");
    const importAuth = firstIndexAfter(imported, 'const onImport = async', 'reauthBeforeReveal');
    expect(importAuth).toBeGreaterThan(importLoading);

    const vault = screen('../../app/(app)/vault.tsx');
    const backupLoading = firstIndexAfter(vault, 'const onBackup = async', "t('common.preparingWallet')");
    const backupAuth = firstIndexAfter(vault, 'const onBackup = async', 'reauthBeforeReveal');
    expect(backupAuth).toBeGreaterThan(backupLoading);
    expect(vault).toContain('inspectAddresses(entropy, slot.backup ?? \'bip39\', \'\', slot.paths, SLOW_INSPECT_IDS)');
    expect(vault).toContain('accountsPreparing ? <LoadingOverlay visible label={t(\'common.preparingWallet\')} />');
  });

  it('starts advertising with preparing-wallet copy before the Bluetooth label', () => {
    const device = screen('../../app/(app)/index.tsx');
    expect(device).toContain("runWithLoading(t('common.preparingWallet'), () => startSimulation())");
    const appState = screen('./AppState.tsx');
    const load = appState.indexOf('secretSession.current.load');
    const starting = appState.indexOf("translate(settingsRef.current.language, 'device.starting')");
    expect(load).toBeGreaterThan(-1);
    expect(starting).toBeGreaterThan(load);
  });
});
