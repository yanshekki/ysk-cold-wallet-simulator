import { describe, expect, it } from 'vitest';
import { LEDGER_INSTALLED_APPS, LEDGER_OS, ONEKEY_FIRMWARE, TREZOR_FIRMWARE } from './index';

/** Live-channel numbers re-fetched 24 Oct 2026. Fail this test rather than ship a stale string. */
const EXPECTED = {
  ledger: {
    'nano-x': '2.7.1',
    stax: '1.10.1',
    flex: '1.6.1',
    gen5: '1.1.1',
    bitcoin: '2.4.2',
    ethereum: '1.23.0',
    solana: '1.16.0',
  },
  onekey: {
    classic: { firmware: '3.12.0', ble: '1.4.1' },
    classic1s: { firmware: '3.21.0', ble: '1.5.6' },
    pure: { firmware: '3.21.0', ble: '1.5.6' },
    touch: { firmware: '4.12.0', ble: '2.3.1' },
    pro: { firmware: '4.21.0', ble: '2.3.7' },
    pro2: { firmware: '1.0.3', ble: '1.0.22' },
    neo: { firmware: '1.0.3', ble: '1.0.22' },
  },
  trezor: { major: 2, minor: 13, patch: 0 },
};

describe('firmware catalog', () => {
  it('reports the live Ledger OS per BLE model', () => {
    expect(LEDGER_OS['nano-x'].se).toBe(EXPECTED.ledger['nano-x']);
    expect(LEDGER_OS.stax.se).toBe(EXPECTED.ledger.stax);
    expect(LEDGER_OS.flex.se).toBe(EXPECTED.ledger.flex);
    expect(LEDGER_OS.gen5.se).toBe(EXPECTED.ledger.gen5);
  });

  it('reports Bitcoin, Ethereum, and Solana Manager versions', () => {
    expect(LEDGER_INSTALLED_APPS.find((app) => app.id === 'bitcoin')?.version).toBe(
      EXPECTED.ledger.bitcoin,
    );
    expect(LEDGER_INSTALLED_APPS.find((app) => app.id === 'ethereum')?.version).toBe(
      EXPECTED.ledger.ethereum,
    );
    expect(LEDGER_INSTALLED_APPS.find((app) => app.id === 'solana')?.version).toBe(
      EXPECTED.ledger.solana,
    );
  });

  it('reports OneKey BLE firmware from config.json', () => {
    for (const [id, expected] of Object.entries(EXPECTED.onekey)) {
      const row = ONEKEY_FIRMWARE[id];
      expect(row.firmware.join('.'), id).toBe(expected.firmware);
      expect(row.ble.join('.'), `${id} ble`).toBe(expected.ble);
    }
  });

  it('reports Trezor Safe 7 2.13.0', () => {
    expect(TREZOR_FIRMWARE).toEqual(EXPECTED.trezor);
  });
});
