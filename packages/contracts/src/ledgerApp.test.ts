import { describe, expect, it } from 'vitest';
import {
  LEDGER_APPS,
  LEDGER_INSTALLED_APPS,
  inferLedgerFamily,
  isLedgerEthereumPlugin,
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
    expect(LEDGER_INSTALLED_APPS.length).toBeGreaterThanOrEqual(100);
    expect(LEDGER_INSTALLED_APPS.some((app) => app.openAppName === 'Cardano ADA')).toBe(true);
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
    expect(matchLedgerApp('Cardano ADA')).toBe('cardano');
    expect(matchLedgerApp('Stellar')).toBe('stellar');
    expect(matchLedgerApp('unknown-chain')).toBeUndefined();
  });

  it('maps overlay names onto APDU families', () => {
    expect(inferLedgerFamily('Cardano ADA')).toBe('cardano');
    expect(inferLedgerFamily('Bitcoin Test')).toBe('bitcoin');
    expect(inferLedgerFamily('Helium-Solana')).toBe('solana');
    expect(inferLedgerFamily('Stellar')).toBe('stellar');
    expect(slugLedgerApp('Cardano ADA')).toBe('cardano');
  });

  it('maps ethereum CHAIN variants onto the ethereum handler family', () => {
    expect(inferLedgerFamily('Moonbeam')).toBe('ethereum');
    expect(inferLedgerFamily('Moonriver')).toBe('ethereum');
    expect(inferLedgerFamily('Harmony')).toBe('ethereum');
    expect(inferLedgerFamily('RSK')).toBe('ethereum');
    expect(inferLedgerFamily('XDC Network')).toBe('ethereum');
    expect(inferLedgerFamily('Sei')).toBe('ethereum');
    expect(inferLedgerFamily('ARTIS sigma1')).toBe('ethereum');
    expect(inferLedgerFamily('Ethereum Classic')).toBe('ethereum');
  });

  it('maps bitcoin-like UTXO forks onto the bitcoin handler family', () => {
    expect(inferLedgerFamily('Dash')).toBe('bitcoin');
    expect(inferLedgerFamily('Digibyte')).toBe('bitcoin');
    expect(inferLedgerFamily('Ravencoin')).toBe('bitcoin');
    expect(inferLedgerFamily('ZClassic')).toBe('bitcoin');
    expect(inferLedgerFamily('Bitcoin Cash')).toBe('bitcoin');
    expect(inferLedgerFamily('Litecoin')).toBe('bitcoin');
  });

  it('maps cosmos-like and polkadot-like names onto existing handlers', () => {
    expect(inferLedgerFamily('Terra')).toBe('cosmos');
    expect(inferLedgerFamily('THORChain')).toBe('cosmos');
    expect(inferLedgerFamily('Cronos POS Chain')).toBe('cosmos');
    expect(inferLedgerFamily('Secret')).toBe('cosmos');
    expect(inferLedgerFamily('Sei - Cosmos')).toBe('cosmos');
    expect(inferLedgerFamily('Aleph Zero')).toBe('polkadot');
    expect(inferLedgerFamily('Avail')).toBe('polkadot');
    expect(inferLedgerFamily('xx network')).toBe('polkadot');
    expect(inferLedgerFamily('Polymesh')).toBe('polkadot');
  });

  it('marks ethereum clear-signing plugins without treating them as unknown signers', () => {
    expect(inferLedgerFamily('Uniswap')).toBe('ethereum-plugin');
    expect(inferLedgerFamily('1inch')).toBe('ethereum-plugin');
    expect(inferLedgerFamily('OKX Web3')).toBe('ethereum-plugin');
    expect(inferLedgerFamily('Rocket Pool')).toBe('ethereum-plugin');
    expect(isLedgerEthereumPlugin('Uniswap')).toBe(true);
    expect(isLedgerEthereumPlugin('ethereum-plugin')).toBe(true);
    expect(isLedgerEthereumPlugin('Ethereum')).toBe(false);
    expect(inferLedgerFamily('Zcash')).toBe('unknown');
  });

  it('stores remapped families on the bundled Manager snapshot', () => {
    const byName = Object.fromEntries(
      LEDGER_INSTALLED_APPS.map((app) => [app.openAppName, app.family]),
    );
    expect(byName['Moonbeam']).toBe('ethereum');
    expect(byName['Dash']).toBe('bitcoin');
    expect(byName['Terra']).toBe('cosmos');
    expect(byName['Aleph Zero']).toBe('polkadot');
    expect(byName['Uniswap']).toBe('ethereum-plugin');
    expect(byName['Zcash']).toBe('unknown');
    const known = LEDGER_INSTALLED_APPS.filter((app) => app.family !== 'unknown').length;
    expect(known).toBe(128);
    expect(LEDGER_INSTALLED_APPS.filter((app) => app.family === 'unknown').length).toBe(77);
  });
});
