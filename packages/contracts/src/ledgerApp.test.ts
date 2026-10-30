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

  it('maps backlog-4 researched apps onto families (ethereum clones, utilities, dedicated)', () => {
    expect(inferLedgerFamily('VeChain')).toBe('ethereum');
    expect(inferLedgerFamily('Aeternity')).toBe('ethereum');
    expect(inferLedgerFamily('Exchange')).toBe('utility');
    expect(inferLedgerFamily('Fido U2F')).toBe('utility');
    expect(inferLedgerFamily('Security Key')).toBe('utility');
    expect(inferLedgerFamily('Seed Tool')).toBe('utility');
    expect(inferLedgerFamily('Recovery Check')).toBe('utility');
    expect(inferLedgerFamily('Ledger Sync')).toBe('utility');
    expect(inferLedgerFamily('Tezos Wallet')).toBe('tezos');
    expect(inferLedgerFamily('Algorand')).toBe('algorand');
    expect(inferLedgerFamily('MultiversX')).toBe('multiversx');
    expect(inferLedgerFamily('Filecoin')).toBe('filecoin');
    expect(inferLedgerFamily('Stacks')).toBe('stacks');
    expect(inferLedgerFamily('Mina')).toBe('mina');
    expect(inferLedgerFamily('Eos')).toBe('eos');
    expect(inferLedgerFamily('Hedera')).toBe('hedera');
    expect(inferLedgerFamily('NEO')).toBe('neo');
    expect(inferLedgerFamily('NEO N3')).toBe('neo');
    expect(inferLedgerFamily('Casper')).toBe('casper');
    expect(inferLedgerFamily('Flare Network')).toBe('flare');
    expect(inferLedgerFamily('Conflux')).toBe('conflux');
    expect(inferLedgerFamily('Binance Chain')).toBe('binance');
    expect(inferLedgerFamily('Waves')).toBe('waves');
    expect(inferLedgerFamily('Aion')).toBe('aion');
    expect(inferLedgerFamily('Aleo')).toBe('aleo');
    expect(inferLedgerFamily('Alephium')).toBe('alephium');
    expect(inferLedgerFamily('Sia')).toBe('sia');
    expect(inferLedgerFamily('Ergo')).toBe('ergo');
    expect(inferLedgerFamily('Arweave')).toBe('arweave');
    expect(inferLedgerFamily('Flow')).toBe('flow');
    expect(inferLedgerFamily('InternetComputer')).toBe('internetcomputer');
    expect(inferLedgerFamily('Starknet')).toBe('starknet');
    expect(inferLedgerFamily('Hathor')).toBe('hathor');
    expect(inferLedgerFamily('Hive')).toBe('hive');
    expect(inferLedgerFamily('Concordium')).toBe('concordium');
    expect(inferLedgerFamily('Symbol')).toBe('symbol');
    expect(inferLedgerFamily('Everscale')).toBe('everscale');
    expect(inferLedgerFamily('QRL')).toBe('qrl');
    expect(inferLedgerFamily('Ardor')).toBe('ardor');
    expect(inferLedgerFamily('FIO')).toBe('fio');
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
    expect(byName['VeChain']).toBe('ethereum');
    expect(byName['Tezos Wallet']).toBe('tezos');
    expect(byName['Exchange']).toBe('utility');
    expect(byName['Eos']).toBe('eos');
    expect(byName['Hedera']).toBe('hedera');
    expect(byName['NEO']).toBe('neo');
    expect(byName['NEO N3']).toBe('neo');
    expect(byName['Casper']).toBe('casper');
    expect(byName['Flare Network']).toBe('flare');
    expect(byName['Conflux']).toBe('conflux');
    expect(byName['Binance Chain']).toBe('binance');
    expect(byName['Waves']).toBe('waves');
    expect(byName['Aion']).toBe('aion');
    expect(byName['Aleo']).toBe('aleo');
    expect(byName['Alephium']).toBe('alephium');
    expect(byName['Sia']).toBe('sia');
    expect(byName['Ergo']).toBe('ergo');
    expect(byName['Arweave']).toBe('arweave');
    expect(byName['Flow']).toBe('flow');
    expect(byName['InternetComputer']).toBe('internetcomputer');
    expect(byName['Starknet']).toBe('starknet');
    expect(byName['Hathor']).toBe('hathor');
    expect(byName['Hive']).toBe('hive');
    expect(byName['Concordium']).toBe('concordium');
    expect(byName['Symbol']).toBe('symbol');
    expect(byName['Everscale']).toBe('everscale');
    expect(byName['QRL']).toBe('qrl');
    expect(byName['Ardor']).toBe('ardor');
    expect(byName['FIO']).toBe('fio');
    expect(byName['Canton']).toBe('canton');
    expect(byName['IOTA']).toBe('iota');
    expect(byName['Kaspa']).toBe('kaspa');
    expect(byName['Namada']).toBe('namada');
    expect(byName['Nervos']).toBe('nervos');
    expect(byName['Spacemesh']).toBe('spacemesh');
    expect(byName['Qubic']).toBe('qubic');
    expect(byName['Solar']).toBe('solar');
    expect(byName['LTO Network']).toBe('lto');
    expect(byName['Factom']).toBe('factom');
    expect(inferLedgerFamily('IOTA Legacy')).toBe('unknown');
    expect(byName['Zcash']).toBe('unknown');
    const known = LEDGER_INSTALLED_APPS.filter((app) => app.family !== 'unknown').length;
    expect(known).toBe(178);
    expect(LEDGER_INSTALLED_APPS.filter((app) => app.family === 'unknown').length).toBe(27);
  });
});
