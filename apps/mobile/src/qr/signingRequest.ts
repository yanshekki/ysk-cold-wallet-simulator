import {
  describeBtcPsbt,
  describeEthTypedData,
  type SigningRequest,
} from '@cws/contracts';
import {
  ETH_DATA_PERSONAL,
  ETH_DATA_TYPED_DATA,
  type BtcPsbtPreview,
  type BtcSignRequest,
  type CosmosSignRequest,
  type EthSignRequest,
  type SolSignRequest,
} from '@cws/protocol-qr';

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
