import { describe, expect, it } from 'vitest';
import { managerCatalogUrl, parseManagerApps } from './ledgerManager';

describe('ledger manager catalog', () => {
  it('uses decimal target ids and the bundled SE version', () => {
    expect(managerCatalogUrl('nano-x')).toContain('target_id=855638020');
    expect(managerCatalogUrl('nano-x')).toContain('firmware_version_name=2.7.1');
  });

  it('maps Manager rows onto families and skips dev tools', () => {
    const apps = parseManagerApps([
      { versionName: 'Solana', version: '1.17.1', isDevTools: false },
      { versionName: 'Bitcoin Test', version: '2.5.1', isDevTools: true },
      { versionName: 'Cardano ADA', version: '8.0.8' },
    ]);
    expect(apps.find((app) => app.id === 'solana')?.family).toBe('solana');
    expect(apps.find((app) => app.id === 'cardano')?.family).toBe('cardano');
    expect(apps.some((app) => app.openAppName === 'Bitcoin Test')).toBe(false);
  });
});
