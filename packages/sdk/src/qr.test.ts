import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import type { ConfirmationPort } from '@cws/contracts';
import { ETH_DATA_TRANSACTION, qrProfile } from '@cws/protocol-qr';
import { ethSignToSigningRequest, exportQrAccountWithPolicy, needsConfirmForQrExport, qrSeedExportRequest } from './qr';

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

describe('QR EVM sign sheet', () => {
  it('uses the UR chain id when the transaction bytes omit one', () => {
    const to = new Uint8Array(20).fill(0x11);
    const value = Uint8Array.from([0x0d, 0xe0, 0xb6, 0xb3, 0xa7, 0x64, 0x00, 0x00]);
    const inner = concatBytes(
      Uint8Array.of(0x80, 0x80, 0x80, 0x94),
      to,
      Uint8Array.of(0x88),
      value,
      Uint8Array.of(0x80),
    );
    const raw = concatBytes(Uint8Array.of(0xc0 + inner.length), inner);
    const sheet = ethSignToSigningRequest({
      requestId: new Uint8Array(16),
      signData: raw,
      dataType: ETH_DATA_TRANSACTION,
      chainId: 43114,
      path: "m/44'/60'/0'/0/0",
    });
    expect(sheet.title).toBe('Sign Avalanche C-Chain transaction');
    expect(sheet.detail?.fields.find((field) => field.label === 'VALUE')?.value).toBe('1 AVAX');
    expect(sheet.title).not.toMatch(/\bETH\b/);
  });
});

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
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

  it('exports eth-hdkey without a hold-to-confirm', async () => {
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
