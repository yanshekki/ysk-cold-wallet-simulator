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
  V2FrameAssembler,
  V2MessageType,
  decodeButtonRequest,
  decodeEthereumAddress,
  decodeEthereumMessageSignature,
  decodeFailure,
  decodeFeatures,
  decodeFrame,
  encodeProtobufFrame,
  encodeRepeatedUint32,
  encodeUint32,
  isAckFrame,
} from './index';
import { decodeFields, encodeBytes, encodeString, readOptionalString } from './proto';
import { concatBytes, hexToBytes } from './bytes';
import { encodeSuccess } from './messages';

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

  it('answers GetPassphraseState with an empty standard-wallet state', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(MessageType.GetPassphraseState, new Uint8Array()));
    expect(reply.type).toBe(MessageType.PassphraseState);
    const fields = decodeFields(reply.payload);
    expect(readOptionalString(fields, 1)).toBe('');
    expect(fields.find((field) => field.field === 2)?.bytes.length).toBe(32);
    expect(fields.find((field) => field.field === 3)?.varint).toBe(0);
  });

  it('answers UnLockDevice as already unlocked without PIN', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(MessageType.UnLockDevice, new Uint8Array()));
    expect(reply.type).toBe(MessageType.UnLockDeviceResponse);
    const fields = decodeFields(reply.payload);
    expect(fields.find((field) => field.field === 1)?.varint).toBe(1);
    expect(fields.find((field) => field.field === 2)?.varint).toBe(0);
    expect(fields.find((field) => field.field === 3)?.varint).toBe(0);
  });

  it('answers EthereumGetPublicKeyOneKey with an xpub without a confirm', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy,
    });
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0]),
      encodeUint32(2, 0),
    );
    const reply = await exchange(
      handler,
      frameV1(MessageType.EthereumGetPublicKeyOneKey, payload),
    );
    expect(reply.type).toBe(MessageType.EthereumPublicKeyOneKey);
    const fields = decodeFields(reply.payload);
    expect(readOptionalString(fields, 2)?.startsWith('xpub')).toBe(true);
    const node = decodeFields(fields.find((field) => field.field === 1)!.bytes);
    expect(node.find((field) => field.field === 6)?.bytes.length).toBe(33);
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
    expect(decodeFailure(reply.payload).code).toBe(FailureType.DataError);
  });

  it('signs a legacy Ethereum transaction after ButtonAck', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
      encodeBytes(5, Uint8Array.from({ length: 20 }, () => 0x11)),
      encodeUint32(11, 1),
    );
    const button = await exchange(handler, frameV1(MessageType.EthereumSignTx, payload));
    expect(button.type).toBe(MessageType.ButtonRequest);
    const reply = await exchange(handler, frameV1(MessageType.ButtonAck, new Uint8Array()));
    expect(reply.type).toBe(MessageType.EthereumTxRequest);
    const fields = decodeFields(reply.payload);
    expect(fields.find((field) => field.field === 3)?.bytes.length).toBe(32);
    expect(fields.find((field) => field.field === 4)?.bytes.length).toBe(32);
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

  it('exports a Solana address without display', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy,
    });
    const payload = concatBytes(encodeRepeatedUint32(1, [0x8000002c, 0x800001f5, 0x80000000]));
    const reply = await exchange(handler, frameV1(MessageType.SolanaGetAddress, payload));
    expect(reply.type).toBe(MessageType.SolanaAddress);
    expect(decodeFields(reply.payload).find((field) => field.field === 1)?.bytes.length).toBeGreaterThan(0);
  });

  it('signs an EIP-1559 transaction after ButtonAck', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
      encodeBytes(5, hexToBytes('0x5208')),
      encodeString(6, '0x1111111111111111111111111111111111111111'),
      encodeUint32(10, 11155111),
    );
    const button = await exchange(handler, frameV1(MessageType.EthereumSignTxEIP1559, payload));
    expect(button.type).toBe(MessageType.ButtonRequest);
    const reply = await exchange(handler, frameV1(MessageType.ButtonAck, new Uint8Array()));
    expect(reply.type).toBe(MessageType.EthereumTxRequest);
  });

  it('signs hashed EIP-712 after ButtonAck', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: classic,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
      encodeBytes(2, new Uint8Array(32).fill(0x11)),
      encodeBytes(3, new Uint8Array(32).fill(0x22)),
    );
    const button = await exchange(handler, frameV1(MessageType.EthereumSignTypedHash, payload));
    expect(button.type).toBe(MessageType.ButtonRequest);
    const signed = await exchange(handler, frameV1(MessageType.ButtonAck, new Uint8Array()));
    expect(signed.type).toBe(MessageType.EthereumTypedDataSignature);
  });
});

describe('OneKey V2 BLE handshake', () => {
  const pro = ONEKEY_MODELS.find((model) => model.id === 'pro')!;
  const entropy = entropyFromMnemonic(FOUNDATION);

  async function exchangeV2(handler: OneKeyV1ProtocolHandler, frame: Uint8Array) {
    const outgoing = await handler.handleWrite(frame);
    expect(outgoing).not.toBeNull();
    const frames = new V2FrameAssembler().drain(outgoing!);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(isAckFrame(frames[0])).toBe(true);
    return decodeFrame(frames[1]);
  }

  it('ACKs a sys Ping and echoes Success 60207 instead of V1 Invalid framing', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    await exchange(handler, frameV1(MessageType.Initialize, new Uint8Array()));
    const ping = encodeProtobufFrame(
      V2MessageType.Ping,
      encodeString(1, 'protobuf-protobuf'),
      0,
      1,
      6,
    );
    const reply = await exchangeV2(handler, ping);
    expect(reply.messageTypeId).toBe(V2MessageType.Success);
    expect(Array.from(reply.pbPayload)).toEqual(Array.from(encodeSuccess('protobuf-protobuf')));
  });

  it('answers ProtocolInfoRequest with an application fingerprint', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const request = encodeProtobufFrame(
      V2MessageType.ProtocolInfoRequest,
      encodeUint32(1, 1),
      0,
      1,
      1,
    );
    const reply = await exchangeV2(handler, request);
    expect(reply.messageTypeId).toBe(V2MessageType.ProtocolInfo);
    const fields = decodeFields(reply.pbPayload);
    expect(fields.find((field) => field.field === 1)?.varint).toBe(1);
    const fingerprint = readOptionalString(fields, 2) ?? '';
    expect(fingerprint.startsWith('application__4.21.0__')).toBe(true);
    expect(fingerprint.endsWith('__PROD__RELEASE')).toBe(true);
  });

  it('reassembles DeviceInfo from 20-byte BLE notifies', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const request = encodeProtobufFrame(V2MessageType.DeviceInfoGet, new Uint8Array(), 0, 1, 3);
    const outgoing = await handler.handleWrite(request);
    expect(outgoing).not.toBeNull();
    const chunks = splitOneKeyV1(outgoing!, 20);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
    const frames = new V2FrameAssembler().drain(concatBytes(...chunks));
    expect(isAckFrame(frames[0])).toBe(true);
    expect(decodeFrame(frames[1]).messageTypeId).toBe(V2MessageType.DeviceInfo);
  });

  it('answers DeviceInfoGet with Pro hardware and firmware version', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const request = encodeProtobufFrame(V2MessageType.DeviceInfoGet, new Uint8Array(), 0, 1, 3);
    const reply = await exchangeV2(handler, request);
    expect(reply.messageTypeId).toBe(V2MessageType.DeviceInfo);
    const fields = decodeFields(reply.pbPayload);
    expect(fields.find((field) => field.field === 1)?.varint).toBe(1);
    expect(fields.find((field) => field.field === 100)?.bytes.length).toBeGreaterThan(0);
    const hw = decodeFields(fields.find((field) => field.field === 100)!.bytes);
    expect(hw.find((field) => field.field === 10)?.varint).toBe(5);
    const coprocessor = decodeFields(fields.find((field) => field.field === 300)!.bytes);
    const bleImage = decodeFields(coprocessor.find((field) => field.field === 30)!.bytes);
    expect(readOptionalString(bleImage, 10)).toBe('2.3.7');
  });

  it('answers Features with a current BLE version', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const request = encodeProtobufFrame(MessageType.GetFeatures, new Uint8Array(), 0, 1, 2);
    const reply = await exchangeV2(handler, request);
    const fields = decodeFields(reply.pbPayload);
    expect(readOptionalString(fields, 502)).toBe('2.3.7');
    expect(readOptionalString(fields, 615)).toBe('2.3.7');
    expect(readOptionalString(fields, 508)).toBe('4.21.0');
  });

  it('answers SESignMessage after a verify confirm, then ButtonAck', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const challenge = encodeBytes(1, Uint8Array.of(1, 2, 3, 4));
    const button = await exchangeV2(
      handler,
      encodeProtobufFrame(MessageType.SESignMessage, challenge, 0, 1, 3),
    );
    expect(button.messageTypeId).toBe(MessageType.ButtonRequest);
    const signed = await exchangeV2(
      handler,
      encodeProtobufFrame(MessageType.ButtonAck, new Uint8Array(), 0, 1, 4),
    );
    expect(signed.messageTypeId).toBe(MessageType.SEMessageSignature);
    expect(decodeFields(signed.pbPayload).find((field) => field.field === 1)?.bytes.length).toBe(32);
    const cert = await exchangeV2(
      handler,
      encodeProtobufFrame(MessageType.ReadSEPublicCert, new Uint8Array(), 0, 1, 5),
    );
    expect(cert.messageTypeId).toBe(MessageType.SEPublicCert);
    expect(decodeFields(cert.pbPayload).find((field) => field.field === 1)?.bytes.length).toBe(32);
  });

  it('does not sign authenticity when the user rejects', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(false),
      slotId: 'slot',
      entropy,
    });
    const challenge = encodeBytes(1, Uint8Array.of(1, 2, 3, 4));
    const reply = await exchangeV2(
      handler,
      encodeProtobufFrame(MessageType.SESignMessage, challenge, 0, 1, 3),
    );
    expect(reply.messageTypeId).toBe(MessageType.Failure);
  });

  it('reports Classic 1s / Pure / Pro 2 device types and firmware', async () => {
    const classic1s = ONEKEY_MODELS.find((model) => model.id === 'classic1s')!;
    const handler = new OneKeyV1ProtocolHandler({
      model: classic1s,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(MessageType.Initialize, new Uint8Array()));
    const fields = decodeFields(reply.payload);
    expect(fields.find((field) => field.field === 600)?.varint).toBe(1);
    expect(readOptionalString(fields, 508)).toBe('3.21.0');
    expect(readOptionalString(fields, 502)).toBe('1.5.6');

    const pro2 = ONEKEY_MODELS.find((model) => model.id === 'pro2')!;
    const pro2Handler = new OneKeyV1ProtocolHandler({
      model: pro2,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const info = await exchangeV2(
      pro2Handler,
      encodeProtobufFrame(V2MessageType.DeviceInfoGet, new Uint8Array(), 0, 1, 3),
    );
    const hw = decodeFields(decodeFields(info.pbPayload).find((field) => field.field === 100)!.bytes);
    expect(hw.find((field) => field.field === 10)?.varint).toBe(7);
  });

  it('reports Touch firmware 4.12.0 and BLE 2.3.1', async () => {
    const touch = ONEKEY_MODELS.find((model) => model.id === 'touch')!;
    const handler = new OneKeyV1ProtocolHandler({
      model: touch,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const reply = await exchange(handler, frameV1(MessageType.GetFeatures, new Uint8Array()));
    const fields = decodeFields(reply.payload);
    expect(readOptionalString(fields, 508)).toBe('4.12.0');
    expect(readOptionalString(fields, 502)).toBe('2.3.1');
  });

  it('still serves GetFeatures after switching onto V2 frames', async () => {
    const handler = new OneKeyV1ProtocolHandler({
      model: pro,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy,
    });
    const request = encodeProtobufFrame(MessageType.GetFeatures, new Uint8Array(), 0, 1, 2);
    const reply = await exchangeV2(handler, request);
    expect(reply.messageTypeId).toBe(MessageType.Features);
    expect(decodeFeatures(reply.pbPayload).vendor).toBe('onekey.so');
    expect(decodeFeatures(reply.pbPayload).model).toBe('pro');
  });
});
