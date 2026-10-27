import type { Brand, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { describeBtcPsbt, describeEthTypedData } from '@cws/contracts';
import {
  BbqrDecoder,
  ETH_DATA_PERSONAL,
  ETH_DATA_TYPED_DATA,
  FountainUrDecoder,
  assertEthSignMatchesSeed,
  decodeBtcSignRequest,
  decodeCosmosSignRequest,
  decodeEthSignRequest,
  decodeSolSignRequest,
  encodeBbqr,
  encodeQrAccount,
  isBbqrPart,
  previewCryptoPsbt,
  previewPsbt,
  resolveQrFormat,
  signBtcMessage,
  signCosmosRequest,
  signCryptoPsbt,
  signEthRequest,
  signPsbtBytes,
  signSolRequest,
  type BtcPsbtPreview,
  type BtcSignRequest,
  type CosmosSignRequest,
  type EthAirgapQr,
  type EthSignRequest,
  type QrFormatId,
  type QrProfile,
  type QrUrKind,
  type SolSignRequest,
} from '@cws/protocol-qr';

export function needsConfirmForQrExport(format?: QrFormatId | QrUrKind): boolean {
  return resolveQrFormat(format) === 'crypto-seed';
}

export function qrSeedExportRequest(brand?: Brand): SigningRequest {
  return {
    brand,
    kind: 'export-seed',
    title: 'Export backup seed',
    path: 'm',
    message: 'This QR encodes seed material. Anyone who scans it can spend.',
    rawPayload: new Uint8Array(),
  };
}

export async function exportQrAccountWithPolicy(options: {
  seed: Uint8Array;
  profile: QrProfile;
  format?: QrFormatId | QrUrKind;
  confirmation: ConfirmationPort;
  brand?: Brand;
}): Promise<EthAirgapQr> {
  const format = options.format ?? options.profile.defaultUr;
  if (needsConfirmForQrExport(format)) {
    const ok = await options.confirmation.confirm(qrSeedExportRequest(options.brand));
    if (!ok) {
      throw new Error('errors.qrExportRejected');
    }
  }
  return encodeQrAccount(options.seed, options.profile, format);
}

export function ethSignToSigningRequest(request: EthSignRequest): SigningRequest {
  if (request.dataType === ETH_DATA_PERSONAL) {
    return {
      kind: 'sign',
      title: 'Sign personal message',
      path: request.path,
      message: ['Sign personal message', request.path, request.origin].filter(Boolean).join('\n'),
      rawPayload: request.signData,
    };
  }
  if (request.dataType === ETH_DATA_TYPED_DATA) {
    return {
      kind: 'sign',
      title: 'Sign typed data',
      path: request.path,
      message: ['Sign typed data', request.path, request.origin].filter(Boolean).join('\n'),
      rawPayload: request.signData,
      detail: describeEthTypedData(request.path, request.signData),
    };
  }
  return {
    kind: 'sign',
    title: 'Sign Ethereum transaction',
    path: request.path,
    message: ['Sign Ethereum transaction', request.path, request.origin].filter(Boolean).join('\n'),
    rawPayload: request.signData,
  };
}

export function psbtToSigningRequest(preview: BtcPsbtPreview): SigningRequest {
  return {
    kind: 'sign',
    title: 'Sign Bitcoin transaction',
    path: preview.path,
    message: ['Sign Bitcoin transaction', preview.path].join('\n'),
    rawPayload: preview.psbt,
    detail: describeBtcPsbt({
      path: preview.path,
      outputs: preview.outputs,
      feeSats: preview.feeSats,
    }),
  };
}

export function solSignToSigningRequest(request: SolSignRequest): SigningRequest {
  return {
    kind: 'sign',
    title: 'Sign Solana transaction',
    path: request.path,
    message: ['Sign Solana transaction', request.path, request.origin].filter(Boolean).join('\n'),
    rawPayload: request.signData,
  };
}

export function cosmosSignToSigningRequest(request: CosmosSignRequest): SigningRequest {
  return {
    kind: 'sign',
    title: 'Sign Cosmos transaction',
    path: request.path,
    message: ['Sign Cosmos transaction', request.path, request.origin].filter(Boolean).join('\n'),
    rawPayload: request.signData,
  };
}

export function btcMessageToSigningRequest(request: BtcSignRequest): SigningRequest {
  return {
    kind: 'sign',
    title: 'Sign Bitcoin message',
    path: request.path,
    message: ['Sign Bitcoin message', request.path].join('\n'),
    rawPayload: request.signData,
  };
}

export type QrScanStatus =
  | { status: 'progress'; received: number; expected: number }
  | { status: 'complete'; qr: EthAirgapQr }
  | { status: 'rejected' };

export class QrAirgapSession {
  private readonly ur = new FountainUrDecoder();
  private readonly bbqr = new BbqrDecoder();
  private busy = false;

  reset(): void {
    this.ur.reset();
    this.bbqr.reset();
    this.busy = false;
  }

  async receive(
    part: string,
    options: {
      seedBytes: Uint8Array;
      confirm: ConfirmationPort['confirm'];
    },
  ): Promise<QrScanStatus> {
    if (this.busy) {
      return { status: 'progress', received: 0, expected: 0 };
    }
    if (isBbqrPart(part)) {
      const progress = this.bbqr.receive(part);
      if (!progress.complete) {
        return { status: 'progress', received: progress.received, expected: progress.expected };
      }
      this.busy = true;
      try {
        if (!progress.success || !progress.payload || progress.type !== 'P') {
          throw new Error(progress.error || 'errors.qrWrongType');
        }
        const preview = previewPsbt(options.seedBytes, progress.payload);
        const ok = await options.confirm(psbtToSigningRequest(preview));
        if (!ok) {
          return { status: 'rejected' };
        }
        const signed = signPsbtBytes(options.seedBytes, progress.payload);
        const frames = encodeBbqr('P', signed.psbt).frames;
        return {
          status: 'complete',
          qr: {
            ur: frames[0] ?? '',
            parts: frames,
            path: preview.path,
            address: preview.address,
            fingerprint: preview.fingerprint,
            name: 'CWS',
            urKind: 'bbqr',
          },
        };
      } finally {
        this.bbqr.reset();
        this.busy = false;
      }
    }
    const progress = this.ur.receive(part);
    if (!progress.complete) {
      return { status: 'progress', received: progress.received, expected: progress.expected };
    }
    this.busy = true;
    try {
      if (!progress.success || !progress.cbor || !progress.type) {
        throw new Error(progress.error || 'errors.qrBadUr');
      }
      if (progress.type === 'crypto-psbt') {
        const preview = previewCryptoPsbt(options.seedBytes, progress.cbor);
        const ok = await options.confirm(psbtToSigningRequest(preview));
        if (!ok) {
          return { status: 'rejected' };
        }
        return { status: 'complete', qr: signCryptoPsbt(options.seedBytes, progress.cbor) };
      }
      if (progress.type === 'sol-sign-request') {
        const request = decodeSolSignRequest(progress.cbor);
        const ok = await options.confirm(solSignToSigningRequest(request));
        if (!ok) {
          return { status: 'rejected' };
        }
        return { status: 'complete', qr: signSolRequest(options.seedBytes, request) };
      }
      if (progress.type === 'cosmos-sign-request') {
        const request = decodeCosmosSignRequest(progress.cbor);
        const ok = await options.confirm(cosmosSignToSigningRequest(request));
        if (!ok) {
          return { status: 'rejected' };
        }
        return { status: 'complete', qr: signCosmosRequest(options.seedBytes, request) };
      }
      if (progress.type === 'btc-sign-request') {
        const request = decodeBtcSignRequest(progress.cbor);
        const ok = await options.confirm(btcMessageToSigningRequest(request));
        if (!ok) {
          return { status: 'rejected' };
        }
        return { status: 'complete', qr: signBtcMessage(options.seedBytes, request) };
      }
      if (progress.type !== 'eth-sign-request') {
        throw new Error('errors.qrWrongType');
      }
      const request = decodeEthSignRequest(progress.cbor);
      assertEthSignMatchesSeed(options.seedBytes, request);
      const ok = await options.confirm(ethSignToSigningRequest(request));
      if (!ok) {
        return { status: 'rejected' };
      }
      const signed = signEthRequest(options.seedBytes, request, request.origin ?? 'CWS');
      return { status: 'complete', qr: signed.qr };
    } finally {
      this.ur.reset();
      this.busy = false;
    }
  }
}
