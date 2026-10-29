import { afterEach, describe, expect, it } from 'vitest';
import {
  applyVersionCatalog,
  catalogVersion,
  isReportableLedgerVersion,
  keepVersionPicks,
  ledgerCatalog,
  ledgerCatalogBase,
  nextVersionPicks,
  parseStoredCatalog,
  parseVersionPicks,
  resetLedgerCatalogOverlay,
  resetLedgerVersionPicks,
  setLedgerCatalogOverlay,
  setLedgerVersionPicks,
  stableVersionList,
  versionsForApp,
  type LedgerInstalledApp,
} from './index';

const cardano: LedgerInstalledApp = {
  id: 'cardano',
  openAppName: 'Cardano ADA',
  version: '8.0.8',
  chip: 'ADA',
  family: 'cardano',
};

afterEach(() => {
  resetLedgerVersionPicks();
  resetLedgerCatalogOverlay();
});

describe('ledger app version picks', () => {
  it('keeps only versions that fit in a GET_VERSION triple', () => {
    expect(isReportableLedgerVersion('7.2.1')).toBe(true);
    expect(isReportableLedgerVersion('8.0.8-rc1')).toBe(false);
    expect(isReportableLedgerVersion('25.10100.0')).toBe(false);
    expect(isReportableLedgerVersion('8.8000001.7')).toBe(false);
    expect(stableVersionList(['8.0.10', '7.2.1', '7.2.1', '8.0.8-rc1', '8.0.8'])).toEqual([
      '7.2.1',
      '8.0.8',
      '8.0.10',
    ]);
  });

  it('offers bundled Nano X Cardano 7.x and keeps 8.0.8 as the default report', () => {
    const choices = versionsForApp(cardano, 'nano-x', null);
    expect(choices).toContain('7.1.1');
    expect(choices).toContain('7.2.1');
    expect(choices).toContain('7.3.1');
    expect(choices).toContain('8.0.8');
    expect(choices).not.toContain('7.0.0');
    expect(choices).not.toContain('8.0.8-rc1');
    expect(catalogVersion('cardano', '0')).toBe('8.0.8');
  });

  it('uses the device bundled list until that device has been synced', () => {
    const bare = versionsForApp(cardano, 'gen5', null);
    expect(bare).toContain('7.3.1');
    expect(bare).toContain('8.0.8');
    expect(bare).not.toContain('7.1.1');

    const synced: LedgerInstalledApp = {
      ...cardano,
      availableVersions: ['7.3.1', '8.0.8'],
    };
    expect(versionsForApp(synced, 'stax', 'stax')).toEqual(['7.3.1', '8.0.8']);
    expect(versionsForApp(synced, 'nano-x', 'stax')).toContain('7.1.1');
  });

  it('keeps the current reported version when it does not fit in three bytes', () => {
    const polymesh = ledgerCatalogBase().find((app) => app.id === 'polymesh');
    expect(polymesh?.version).toBe('8.8000001.7');
    expect(versionsForApp(polymesh!, 'nano-x', null)).toContain('8.8000001.7');
  });

  it('stores a pick separately from the catalog default', () => {
    const picks = nextVersionPicks({}, [cardano], 'cardano', '7.2.1', 'nano-x', null);
    expect(picks).toEqual({ cardano: '7.2.1' });
    expect(nextVersionPicks({}, [cardano], 'cardano', '7.0.0', 'nano-x', null)).toBeUndefined();
    expect(nextVersionPicks({ cardano: '7.2.1' }, [cardano], 'cardano', '8.0.8', 'nano-x', null)).toEqual({});

    setLedgerVersionPicks(picks);
    expect(catalogVersion('cardano', '0')).toBe('7.2.1');
    expect(ledgerCatalog().find((app) => app.id === 'cardano')?.version).toBe('7.2.1');
    expect(ledgerCatalogBase().find((app) => app.id === 'cardano')?.version).toBe('8.0.8');
    expect(catalogVersion('ethereum', '0')).toBe('1.22.5');
  });

  it('sync keeps the by-target version as the default and drops picks the new list removed', () => {
    const fresh = applyVersionCatalog([cardano], {
      cardano: ['7.2.1', '8.0.10', '8.0.8-rc1', '25.10100.0', '8.0.8'],
    });
    expect(fresh[0]?.version).toBe('8.0.8');
    expect(fresh[0]?.availableVersions).toEqual(['7.2.1', '8.0.8', '8.0.10']);
    expect(keepVersionPicks({ cardano: '7.2.1', solana: '1.0.0' }, fresh, 'nano-x')).toEqual({
      cardano: '7.2.1',
    });
    const onlyLatest = applyVersionCatalog([cardano], { cardano: ['8.0.8'] });
    expect(keepVersionPicks({ cardano: '7.2.1' }, onlyLatest, 'nano-x')).toEqual({});
  });

  it('reads a legacy catalog array and a synced object', () => {
    expect(parseStoredCatalog([cardano])).toEqual({ modelId: null, apps: [cardano] });
    expect(parseStoredCatalog({ modelId: 'stax', apps: [cardano] })).toEqual({
      modelId: 'stax',
      apps: [cardano],
    });
    expect(parseStoredCatalog({ modelId: '', apps: [] })).toBeUndefined();
    expect(parseVersionPicks({ cardano: '7.2.1', bad: '7.2.1-rc1', empty: '' })).toEqual({
      cardano: '7.2.1',
    });
  });

  it('does not let an overlay hide a pick on a different app', () => {
    setLedgerCatalogOverlay(
      [{ ...cardano, version: '8.0.10', availableVersions: ['8.0.10'] }],
      'nano-x',
    );
    setLedgerVersionPicks({ cardano: '7.2.1' });
    expect(catalogVersion('cardano', '0')).toBe('7.2.1');
  });
});
