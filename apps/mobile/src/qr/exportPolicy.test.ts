import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import type { ConfirmationPort } from '@cws/contracts';
import { qrProfile } from '@cws/protocol-qr';
import { exportQrAccountWithPolicy, needsConfirmForQrExport } from '@cws/sdk';
import { needsConfirmForQrExport as mobileNeedsConfirm, qrSeedExportRequest } from './exportPolicy';

const FOUNDATION = 'test test test test test test test test test test test junk';

describe('mobile QR export policy', () => {
  it('re-exports crypto-seed confirmation from the sdk', () => {
    expect(mobileNeedsConfirm('crypto-seed')).toBe(true);
    expect(needsConfirmForQrExport('eth-hdkey')).toBe(false);
    expect(qrSeedExportRequest('onekey').kind).toBe('export-seed');
  });

  it('cannot encode crypto-seed without confirm', async () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const confirmation: ConfirmationPort = {
      async confirm() {
        return false;
      },
      async getPassphrase() {
        return undefined;
      },
    };
    await expect(
      exportQrAccountWithPolicy({
        seed,
        profile: qrProfile('airgap'),
        format: 'crypto-seed',
        confirmation,
      }),
    ).rejects.toThrow('errors.qrExportRejected');
  });
});
