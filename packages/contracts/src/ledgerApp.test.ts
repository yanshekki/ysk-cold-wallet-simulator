import { describe, expect, it } from 'vitest';
import {
  LEDGER_APPS,
  LEDGER_INSTALLED_APPS,
  inferLedgerFamily,
  ledgerAppChip,
  ledgerAppLabel,
  ledgerPickerApps,
  matchLedgerApp,
  slugLedgerApp,
} from './index';

describe('ledger app labels', () => {
  it('shows the current app, not the next action', () => {
    expect(ledgerAppLabel('dashboard')).toBe('BOLOS dashboard');
    expect(ledgerAppLabel('bitcoin')).toBe('Bitcoin');
    expect(ledgerAppLabel('ethereum')).toBe('Ethereum');
    expect(ledgerAppChip('dashboard')).toBe('BOLOS');
    expect(ledgerAppChip('bitcoin')).toBe('BTC');
    expect(ledgerAppChip('ethereum')).toBe('ETH');
    expect(ledgerAppChip('avalanche')).toBe('AVAX');
    expect(ledgerAppChip('solana')).toBe('SOL');
  });

  it('lists BOLOS plus the installed Manager catalog', () => {
    expect(LEDGER_APPS[0]).toBe('dashboard');
    expect(LEDGER_APPS).toContain('solana');
    expect(LEDGER_INSTALLED_APPS.length).toBeGreaterThanOrEqual(8);
  });

  it('orders the open-app picker by common hardware-wallet usage', () => {
    const apps = ledgerPickerApps();
    expect(apps.slice(0, 4)).toEqual(['dashboard', 'bitcoin', 'ethereum', 'solana']);
    expect(apps.indexOf('xrp')).toBeLessThan(apps.indexOf('avalanche'));
    expect(apps.indexOf('dogecoin')).toBeLessThan(apps.indexOf('aptos'));
  });

  it('matches OPEN_APP names from Ledger Wallet', () => {
    expect(matchLedgerApp('Ethereum')).toBe('ethereum');
    expect(matchLedgerApp('Bitcoin')).toBe('bitcoin');
    expect(matchLedgerApp('Solana')).toBe('solana');
    expect(matchLedgerApp('Avalanche')).toBe('avalanche');
    expect(matchLedgerApp('unknown-chain')).toBeUndefined();
  });

  it('maps overlay names onto APDU families', () => {
    expect(inferLedgerFamily('Cardano ADA')).toBe('cardano');
    expect(inferLedgerFamily('Bitcoin Test')).toBe('bitcoin');
    expect(inferLedgerFamily('Helium-Solana')).toBe('solana');
    expect(slugLedgerApp('Cardano ADA')).toBe('cardano');
  });
});
