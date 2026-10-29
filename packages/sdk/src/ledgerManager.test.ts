import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applicationsCatalogUrl, deviceVersionUrl, fetchManagerCatalog, managerCatalogUrl, parseDeviceVersionId, parseManagerApps } from './ledgerManager';
import { scanApplicationVersions } from './ledgerCatalogScan';

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ledger manager catalog', () => {
  it('uses decimal target ids and the bundled SE version', () => {
    expect(managerCatalogUrl('nano-x')).toContain('target_id=855638020');
    expect(managerCatalogUrl('nano-x')).toContain('firmware_version_name=2.7.1');
  });

  it('points version sync at the public device and applications endpoints', () => {
    expect(deviceVersionUrl('nano-x')).toContain('target_id=855638020');
    expect(deviceVersionUrl('stax')).toContain('target_id=857735172');
    expect(applicationsCatalogUrl()).toBe('https://manager.api.live.ledger.com/api/applications?provider=1');
    expect(parseDeviceVersionId({ id: 9 })).toBe(9);
  });

  it('keeps provider-1 builds for one device and drops the rest', () => {
    const payload = [
      {
        name: 'Cardano ADA',
        description: 'brace } and \\"quote\\"',
        application_versions: [
          { version: '7.2.1', device_versions: [9], providers: [1], notes: 'ok' },
          { version: '7.0.0', device_versions: [9], providers: [3], notes: 'club' },
          { version: '8.0.8', device_versions: [17], providers: [1], notes: 'stax only' },
          { version: '8.0.8-rc1', device_versions: [9], providers: [1], notes: 'rc' },
          { version: '25.10100.0', device_versions: [9], providers: [1], notes: 'wide' },
          { version: '8.0.8', device_versions: [9, 17], providers: [1], notes: 'dup' },
        ],
        parent: null,
      },
    ];
    const indexed = scanApplicationVersions(JSON.stringify(payload), 9, 1);
    expect(indexed.cardano).toEqual(['7.2.1', '8.0.8']);
    expect(() => scanApplicationVersions('{"no":"array"}', 9)).toThrow(/could not be read/);
  });

  it.skipIf(!process.env.LEDGER_APPLICATIONS_JSON)('indexes a local applications dump', () => {
    const indexed = scanApplicationVersions(readFileSync(process.env.LEDGER_APPLICATIONS_JSON ?? '', 'utf8'), 9, 1);
    expect(indexed.cardano).toContain('7.2.1');
    expect(indexed.cardano).toContain('8.0.8');
    expect(indexed.cardano).not.toContain('7.0.0');
    expect(indexed.cardano).not.toContain('8.0.8-rc1');
    expect(indexed.ethereum?.length).toBeGreaterThan(1);
  });

  it('merges the by-target default with published versions', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('/v2/apps/by-target')) {
        return jsonResponse([{ versionName: 'Cardano ADA', version: '8.0.8' }]);
      }
      if (href.includes('/get_device_version')) {
        return jsonResponse({ id: 9, name: 'Nano X' });
      }
      return jsonResponse([
        {
          name: 'Cardano ADA',
          application_versions: [
            { version: '7.2.1', device_versions: [9], providers: [1] },
            { version: '8.0.10', device_versions: [9], providers: [1] },
            { version: '8.0.8', device_versions: [9], providers: [1] },
          ],
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const apps = await fetchManagerCatalog('nano-x');
    expect(apps.map((app) => app.id)).toEqual(['cardano']);
    expect(apps[0]?.version).toBe('8.0.8');
    expect(apps[0]?.availableVersions).toEqual(['7.2.1', '8.0.8', '8.0.10']);
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
