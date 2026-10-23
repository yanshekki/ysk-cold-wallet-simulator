import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { ONEKEY_MODELS, type ConfirmationPort } from '@cws/contracts';
import { derivePrivateKey, ethereumAddressFromPrivateKey, signPersonalMessage } from './crypto';
import { DEFAULT_MTU, V1Reassembler, frameV1, splitOneKeyV1 } from './framing';
import { OneKeyV1ProtocolHandler } from './handler';
import {
  ButtonRequestType,
  FailureType,
  MessageType,
  decodeButtonRequest,
  decodeEthereumAddress,
  decodeEthereumMessageSignature,
  decodeFailure,
  decodeFeatures,
  encodeRepeatedUint32,
  encodeUint32,
} from './index';
import { decodeFields, encodeBytes, encodeString, readOptionalString } from './proto';
import { concatBytes } from './bytes';

const FOUNDATION = 'test test test test test test test test test test test junk';
const PATH = "m/44'/60'/0'/0/0";
const EXPECTED_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function entropyFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

function autoConfirm(accept = true): ConfirmationPort {
  return {
    async confirm() {
      return accept;
    },
    async getPassphrase() {
      return undefined;
    },
  };
}

async function exchange(
  handler: OneKeyV1ProtocolHandler,
  framed: Uint8Array,
  mtu = DEFAULT_MTU,
): Promise<{ type: number; payload: Uint8Array }> {
  const incoming = splitOneKeyV1(framed, mtu);
  let outgoing: Uint8Array | null = null;
  for (const packet of incoming) {
    outgoing = await handler.handleWrite(packet);
  }
  expect(outgoing).not.toBeNull();
  const assembler = new V1Reassembler();
  let assembled = null;
  for (const packet of splitOneKeyV1(outgoing!, mtu)) {
    assembled = assembler.push(packet);
  }
  expect(assembled).not.toBeNull();
  return assembled!;
}

function ethPathPayload(): Uint8Array {
  return concatBytes(
    encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
    encodeUint32(2, 1),
  );
}

describe('OneKeyV1ProtocolHandler', () => {
  const classic = ONEKEY_MODELS.find((model) => model.id === 'classic')!;
  const entropy = entropyFromMnemonic(FOUNDATION);

  it('answers Initialize with Features', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(MessageType.Initialize, new Uint8Array()));
    expect(reply.type).toBe(MessageType.Features);
    const features = decodeFeatures(reply.payload);
    expect(features.vendor).toBe('onekey.so');
    expect(features.model).toBe('classic');
    expect(features.initialized).toBe(true);
    expect(features.major).toBe(3);
  });

  it('reassembles a multi-chunk Features notify', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(MessageType.GetFeatures, new Uint8Array()), 20);
    expect(reply.type).toBe(MessageType.Features);
    expect(decodeFeatures(reply.payload).vendor).toBe('onekey.so');
  });

  it('returns Failure for an unknown message type', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(999, new Uint8Array()));
    expect(reply.type).toBe(MessageType.Failure);
    expect(decodeFailure(reply.payload).code).toBe(FailureType.UnexpectedMessage);
  });

  it('does not fake success for EthereumSignTx', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(MessageType.EthereumSignTx, new Uint8Array()));
    expect(reply.type).toBe(MessageType.Failure);
    expect(decodeFailure(reply.payload).code).toBe(FailureType.UnexpectedMessage);
  });

  it('exports the known Ethereum address after ButtonAck', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const button = await exchange(
      handler,
      frameV1(MessageType.EthereumGetAddress, ethPathPayload()),
    );
    expect(button.type).toBe(MessageType.ButtonRequest);
    expect(decodeButtonRequest(button.payload)).toBe(ButtonRequestType.Address);

    const reply = await exchange(handler, frameV1(MessageType.ButtonAck, new Uint8Array()));
    expect(reply.type).toBe(MessageType.EthereumAddress);
    expect(decodeEthereumAddress(reply.payload).toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });

  it('does not sign when the user rejects after ButtonAck', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy,
    });
    await exchange(handler, frameV1(MessageType.EthereumGetAddress, ethPathPayload()));
    const reply = await exchange(handler, frameV1(MessageType.ButtonAck, new Uint8Array()));
    expect(reply.type).toBe(MessageType.Failure);
    expect(decodeFailure(reply.payload).code).toBe(FailureType.ActionCancelled);
  });

  it('signs a personal message with a real secp256k1 signature', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const message = new TextEncoder().encode('hello');
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
      encodeBytes(2, message),
    );
    const button = await exchange(handler, frameV1(MessageType.EthereumSignMessage, payload));
    expect(button.type).toBe(MessageType.ButtonRequest);

    const reply = await exchange(handler, frameV1(MessageType.ButtonAck, new Uint8Array()));
    expect(reply.type).toBe(MessageType.EthereumMessageSignature);
    const decoded = decodeEthereumMessageSignature(reply.payload);
    expect(decoded.address.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
    expect(decoded.signature.length).toBe(65);
    const expected = signPersonalMessage(derivePrivateKey(entropy, PATH), message);
    expect(Array.from(decoded.signature)).toEqual(Array.from(expected));
  });

  it('handles OneKey-typed EthereumGetAddress', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    await exchange(handler, frameV1(MessageType.EthereumGetAddressOneKey, ethPathPayload()));
    const reply = await exchange(handler, frameV1(MessageType.ButtonAck, new Uint8Array()));
    expect(reply.type).toBe(MessageType.EthereumAddressOneKey);
    expect(decodeEthereumAddress(reply.payload).toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });

  it('returns a Bitcoin testnet address without a button for show_display=false', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x80000001, 0x80000000, 0, 0]),
      encodeString(2, 'Testnet'),
    );
    const reply = await exchange(handler, frameV1(MessageType.GetAddress, payload));
    expect(reply.type).toBe(MessageType.Address);
    const address = readOptionalString(decodeFields(reply.payload), 1) ?? '';
    expect(address.startsWith('m') || address.startsWith('n')).toBe(true);
  });

  it('derives the foundry default address', () => {
    const key = derivePrivateKey(entropy, PATH);
    expect(ethereumAddressFromPrivateKey(key).toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });
});
