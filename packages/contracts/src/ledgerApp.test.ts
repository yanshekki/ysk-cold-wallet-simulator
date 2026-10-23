import { describe, expect, it } from 'vitest';
import {
  LEDGER_APPS,
  LEDGER_INSTALLED_APPS,
  ledgerAppChip,
  ledgerAppLabel,
  matchLedgerApp,
} from './index';

describe('ledger app labels', () => {
  it('shows the current app, not the next action', () => {
    expect(ledgerAppLabel('dashboard')).toBe('BOLOS dashboard');
    expect(ledgerAppLabel('bitcoin')).toBe('Bitcoin');
    expect(ledgerAppLabel('ethereum')).toBe('Ethereum');
    expect(ledgerAppChip('dashboard')).toBe('BOLOS');
    expect(ledgerAppChip('bitcoin')).toBe('BTC');
    expect(ledgerAppChip('ethereum')).toBe('ETH');
    expect(ledgerAppChip('solana')).toBe('SOL');
  });

  it('lists BOLOS plus the installed Manager catalog', () => {
    expect(LEDGER_APPS[0]).toBe('dashboard');
    expect(LEDGER_APPS).toContain('solana');
    expect(LEDGER_INSTALLED_APPS.length).toBeGreaterThanOrEqual(8);
  });

  it('matches OPEN_APP names from Ledger Wallet', () => {
    expect(matchLedgerApp('Ethereum')).toBe('ethereum');
    expect(matchLedgerApp('Bitcoin')).toBe('bitcoin');
    expect(matchLedgerApp('Solana')).toBe('solana');
    expect(matchLedgerApp('unknown-chain')).toBeUndefined();
  });
});
