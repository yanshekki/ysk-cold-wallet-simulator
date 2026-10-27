import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import type { ConfirmationPort } from '@cws/contracts';
import { qrProfile } from '@cws/protocol-qr';
import { exportQrAccountWithPolicy, needsConfirmForQrExport, qrSeedExportRequest } from './qr';

const FOUNDATION = 'test test test test test test test test test test test junk';

function port(accept = true): ConfirmationPort & { kinds: string[] } {
  const kinds: string[] = [];
  return {
    kinds,
    async confirm(request) {
      kinds.push(request.kind);
      return accept;
    },
    async getPassphrase() {
      return undefined;
    },
  };
}

describe('QR export policy', () => {
  it('requires confirmation only for crypto-seed', () => {
    expect(needsConfirmForQrExport('crypto-seed')).toBe(true);
    expect(needsConfirmForQrExport('eth-hdkey')).toBe(false);
    expect(needsConfirmForQrExport('crypto-hdkey')).toBe(false);
    expect(qrSeedExportRequest('ledger').kind).toBe('export-seed');
  });

  it('blocks crypto-seed export until the user confirms', async () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const confirmation = port(true);
    const qr = await exportQrAccountWithPolicy({
      seed,
      profile: qrProfile('keystone'),
      format: 'crypto-seed',
      confirmation,
      brand: 'ledger',
    });
    expect(confirmation.kinds).toEqual(['export-seed']);
    expect(qr.urKind).toBe('crypto-seed');
  });

  it('does not encode crypto-seed when confirmation is rejected', async () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    await expect(
      exportQrAccountWithPolicy({
        seed,
        profile: qrProfile('keystone'),
        format: 'crypto-seed',
        confirmation: port(false),
      }),
    ).rejects.toThrow('errors.qrExportRejected');
  });

  it('exports eth-hdkey without a slide-to-confirm', async () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const confirmation = port(true);
    const qr = await exportQrAccountWithPolicy({
      seed,
      profile: qrProfile('keystone'),
      format: 'eth-hdkey',
      confirmation,
    });
    expect(confirmation.kinds).toEqual([]);
    expect(qr.urKind).toBe('crypto-hdkey');
  });
});
