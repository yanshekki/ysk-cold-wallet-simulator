import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { TREZOR_MODELS, type ConfirmationPort } from '@cws/contracts';
import { asBytes, concatBytes, encodeUtf8, equalBytes, randomBytes } from './bytes';
import { derivePrivateKey, ethereumAddressFromPrivateKey, signPersonalMessage } from './crypto';
import {
  BROADCAST_CID,
  CTRL_ALLOC_REQUEST,
  CTRL_ENCRYPTED,
  CTRL_HANDSHAKE_COMPLETE,
  CTRL_HANDSHAKE_INIT,
  decodeTransportFrames,
  encodeTransport,
  isAck,
  withSeq,
} from './framing';
import { TrezorThpProtocolHandler } from './handler';
import {
  ButtonRequestType,
  FailureType,
  INTERNAL_MODEL,
  MessageType,
  ThpPairingMethod,
  TREZOR_STATE_UNPAIRED,
  decodeButtonRequest,
  decodeCodeEntryCommitment,
  decodeCodeEntryCpaceTrezor,
  decodeCodeEntrySecret,
  decodeDeviceProperties,
  decodeEthereumAddress,
  decodeEthereumMessageSignature,
  decodeFailure,
  decodeFeatures,
  encodeCodeEntryChallenge,
  encodeCodeEntryCpaceHostTag,
  encodeCredentialRequest,
  encodePairingRequest,
  encodeSelectMethod,
  encodeTypedStructAck,
  encodeTypedValueAck,
  EthereumDataType,
  InputScriptType,
  TxRequestType,
} from './messages';
import {
  decodeFields,
  encodeBytes,
  encodeMessage,
  encodeRepeatedUint32,
  encodeString,
  encodeUint32,
  readOptionalString,
} from './proto';
import { ThpNoiseInitiator } from './noise';
import { Cpace, codeEntryCommitment } from './pairing';

const FOUNDATION = 'test test test test test test test test test test test junk';
const PATH = "m/44'/60'/0'/0/0";
const EXPECTED_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const safe7 = TREZOR_MODELS.find((model) => model.id === 'safe-7')!;

function entropyFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

function autoConfirm(acceptSigning = true): ConfirmationPort & { pairingCode: string | null } {
  const port: ConfirmationPort & { pairingCode: string | null } = {
    pairingCode: null,
    async confirm(request) {
      if (request.path === 'pairing') {
        return true;
      }
      return acceptSigning;
    },
    async getPassphrase() {
      return undefined;
    },
    onPairingCode(code) {
      port.pairingCode = code;
    },
  };
  return port;
}

function encodeL4(sessionId: number, type: number, payload: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(sessionId), Uint8Array.of((type >> 8) & 0xff, type & 0xff), payload);
}

function decodeL4(plain: Uint8Array): { sessionId: number; type: number; payload: Uint8Array } {
  return {
    sessionId: plain[0],
    type: (plain[1] << 8) | plain[2],
    payload: plain.subarray(3),
  };
}

async function send(handler: TrezorThpProtocolHandler, framed: Uint8Array) {
  const outgoing = await handler.handleWrite(framed);
  expect(outgoing).not.toBeNull();
  return decodeTransportFrames(outgoing!);
}

function ethPathPayload(): Uint8Array {
  return concatBytes(encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]), encodeUint32(2, 1));
}

class ThpHost {
  readonly confirmation: ConfirmationPort & { pairingCode: string | null };
  readonly handler: TrezorThpProtocolHandler;
  cid = 0;
  sendSeq = 0;
  initiator: ThpNoiseInitiator | undefined;
  properties: Uint8Array = new Uint8Array();

  constructor(
    acceptSigning = true,
    confirmation?: ConfirmationPort & { pairingCode: string | null },
  ) {
    this.confirmation = confirmation ?? autoConfirm(acceptSigning);
    this.handler = new TrezorThpProtocolHandler({
      model: safe7,
      confirmation: this.confirmation,
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
  }

  async allocate(): Promise<void> {
    const nonce = randomBytes(8);
    const frames = await send(this.handler, encodeTransport(CTRL_ALLOC_REQUEST, BROADCAST_CID, nonce));
    expect(frames).toHaveLength(1);
    expect(frames[0].ctrl).toBe(0x41);
    expect(equalBytes(frames[0].payload.subarray(0, 8), nonce)).toBe(true);
    this.cid = (frames[0].payload[8] << 8) | frames[0].payload[9];
    this.properties = asBytes(frames[0].payload.subarray(10));
  }

  async handshake(): Promise<void> {
    this.initiator = new ThpNoiseInitiator(this.properties);
    const init = this.initiator.initRequest();
    const initFrames = await send(
      this.handler,
      encodeTransport(withSeq(CTRL_HANDSHAKE_INIT, this.sendSeq), this.cid, init),
    );
    this.sendSeq ^= 1;
    expect(isAck(initFrames[0].ctrl)).toBe(true);
    expect(initFrames[1].payload.length).toBe(96);
    const completion = this.initiator.completeRequest(initFrames[1].payload);
    const done = await send(
      this.handler,
      encodeTransport(withSeq(CTRL_HANDSHAKE_COMPLETE, this.sendSeq), this.cid, completion),
    );
    this.sendSeq ^= 1;
    const state = this.initiator.finish(done[1].payload);
    expect(state).toBe(TREZOR_STATE_UNPAIRED);
  }

  async app(type: number, payload: Uint8Array, sessionId = 0) {
    const cipher = this.initiator!.encrypt(encodeL4(sessionId, type, payload));
    const frames = await send(
      this.handler,
      encodeTransport(withSeq(CTRL_ENCRYPTED, this.sendSeq), this.cid, cipher),
    );
    this.sendSeq ^= 1;
    expect(isAck(frames[0].ctrl)).toBe(true);
    const plain = this.initiator!.decrypt(frames[1].payload);
    return decodeL4(plain);
  }

  async pair(): Promise<void> {
    const approved = await this.app(
      MessageType.ThpPairingRequest,
      encodePairingRequest('laptop', 'Trezor Suite'),
    );
    expect(approved.type).toBe(MessageType.ThpPairingRequestApproved);
    const commitment = await this.app(
      MessageType.ThpSelectMethod,
      encodeSelectMethod(ThpPairingMethod.CodeEntry),
    );
    expect(commitment.type).toBe(MessageType.ThpCodeEntryCommitment);
    const challenge = randomBytes(16);
    const cpace = await this.app(MessageType.ThpCodeEntryChallenge, encodeCodeEntryChallenge(challenge));
    expect(cpace.type).toBe(MessageType.ThpCodeEntryCpaceTrezor);
    expect(this.confirmation.pairingCode).toMatch(/^\d{6}$/);
    const hostCpace = new Cpace(this.initiator!.handshakeHash);
    hostCpace.generateKeys(this.confirmation.pairingCode!);
    hostCpace.computeSharedSecret(decodeCodeEntryCpaceTrezor(cpace.payload));
    const secret = await this.app(
      MessageType.ThpCodeEntryCpaceHostTag,
      encodeCodeEntryCpaceHostTag(hostCpace.publicKey, hostCpace.hostTag()),
    );
    expect(secret.type).toBe(MessageType.ThpCodeEntrySecret);
    expect(
      equalBytes(decodeCodeEntryCommitment(commitment.payload), codeEntryCommitment(decodeCodeEntrySecret(secret.payload))),
    ).toBe(true);
  }
}

describe('TrezorThpProtocolHandler', () => {
  it('echoes the allocation nonce and advertises T3W1 Code Entry only', async () => {
    const host = new ThpHost();
    await host.allocate();
    expect(host.cid).toBe(0x0001);
    const props = decodeDeviceProperties(host.properties);
    expect(props.internalModel).toBe(INTERNAL_MODEL);
    expect(props.protocolMajor).toBe(2);
    expect(props.pairingMethods).toEqual([ThpPairingMethod.CodeEntry]);
  });

  it('completes a Noise XX handshake against a test initiator', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    expect(host.initiator?.handshakeHash.length).toBe(32);
  });

  it('pairs with Code Entry, then answers Initialize with Features', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    const end = await host.app(MessageType.ThpEndRequest, new Uint8Array());
    expect(end.type).toBe(MessageType.ThpEndResponse);
    expect(host.confirmation.pairingCode).toBeNull();
    const features = await host.app(MessageType.Initialize, new Uint8Array());
    expect(features.type).toBe(MessageType.Features);
    const decoded = decodeFeatures(features.payload);
    expect(decoded.vendor).toBe('trezor.io');
    expect(decoded.internalModel).toBe(INTERNAL_MODEL);
    expect(decoded.initialized).toBe(true);
    expect(decoded.major).toBe(2);
    expect(decoded.minor).toBe(13);
    expect(decoded.patch).toBe(0);
  });

  it('exports the foundation Ethereum address after confirm', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const button = await host.app(MessageType.EthereumGetAddress, ethPathPayload());
    expect(button.type).toBe(MessageType.ButtonRequest);
    expect(decodeButtonRequest(button.payload)).toBe(ButtonRequestType.Address);
    const reply = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(reply.type).toBe(MessageType.EthereumAddress);
    expect(decodeEthereumAddress(reply.payload).toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });

  it('does not sign when the user rejects', async () => {
    const host = new ThpHost(false);
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    await host.app(MessageType.EthereumGetAddress, ethPathPayload());
    const reply = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(reply.type).toBe(MessageType.Failure);
    expect(decodeFailure(reply.payload).code).toBe(FailureType.ActionCancelled);
  });

  it('signs a personal message with a real secp256k1 signature', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const message = encodeUtf8('hello');
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
      encodeBytes(2, message),
    );
    await host.app(MessageType.EthereumSignMessage, payload);
    const reply = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(reply.type).toBe(MessageType.EthereumMessageSignature);
    const decoded = decodeEthereumMessageSignature(reply.payload);
    expect(decoded.address.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
    const entropy = entropyFromMnemonic(FOUNDATION);
    const expected = signPersonalMessage(derivePrivateKey(entropy, PATH), message);
    expect(Array.from(decoded.signature)).toEqual(Array.from(expected));
  });

  it('cancels pairing when the user rejects', async () => {
    const confirmation = autoConfirm(true);
    confirmation.confirm = async () => false;
    const host = new ThpHost(true, confirmation);
    await host.allocate();
    await host.handshake();
    const reply = await host.app(
      MessageType.ThpPairingRequest,
      encodePairingRequest('laptop', 'Trezor Suite'),
    );
    expect(reply.type).toBe(MessageType.Failure);
    expect(decodeFailure(reply.payload).code).toBe(FailureType.ActionCancelled);
    expect(confirmation.pairingCode).toBeNull();
  });

  it('signs a legacy Ethereum transaction after ButtonAck', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
      encodeBytes(5, Uint8Array.from({ length: 20 }, () => 0x11)),
      encodeUint32(11, 1),
    );
    const button = await host.app(MessageType.EthereumSignTx, payload);
    expect(button.type).toBe(MessageType.ButtonRequest);
    const reply = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(reply.type).toBe(MessageType.EthereumTxRequest);
  });

  it('returns Failure for empty EthereumSignTx and unknown types', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const tx = await host.app(MessageType.EthereumSignTx, new Uint8Array());
    expect(tx.type).toBe(MessageType.Failure);
    const unknown = await host.app(999, new Uint8Array());
    expect(unknown.type).toBe(MessageType.Failure);
    expect(decodeFailure(unknown.payload).code).toBe(FailureType.UnexpectedMessage);
  });

  it('exports a Stellar G-address after confirm', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const payload = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x80000094, 0x80000000]),
      encodeUint32(2, 1),
    );
    const button = await host.app(MessageType.StellarGetAddress, payload);
    expect(button.type).toBe(MessageType.ButtonRequest);
    const reply = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(reply.type).toBe(MessageType.StellarAddress);
    const address = readOptionalString(decodeFields(reply.payload), 1) ?? '';
    expect(address.startsWith('G')).toBe(true);
  });

  it('signs a 1-in-1-out Bitcoin tx with BIP143', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const start = await host.app(
      MessageType.SignTx,
      concatBytes(encodeUint32(1, 1), encodeUint32(2, 1)),
    );
    expect(start.type).toBe(MessageType.TxRequest);
    const input = concatBytes(
      encodeRepeatedUint32(1, [0x80000054, 0x80000000, 0x80000000, 0, 0]),
      encodeBytes(2, new Uint8Array(32).fill(0x11)),
      encodeUint32(3, 0),
      encodeUint32(8, 10000),
    );
    const mid = await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(2, input)));
    expect(mid.type).toBe(MessageType.TxRequest);
    const output = concatBytes(encodeString(1, 'bc1qtest'), encodeUint32(2, 8000));
    const button = await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(5, output)));
    expect(button.type).toBe(MessageType.ButtonRequest);
    const done = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(done.type).toBe(MessageType.TxRequest);
    expect(decodeFields(done.payload).find((field) => field.field === 1)?.varint).toBe(TxRequestType.TXFINISHED);
    expect(decodeFields(done.payload).find((field) => field.field === 3)?.bytes.length).toBeGreaterThan(8);
  });

  it('signs a 2-in-2-out Bitcoin tx with BIP143 and a change output', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const start = await host.app(MessageType.SignTx, concatBytes(encodeUint32(1, 2), encodeUint32(2, 2)));
    expect(start.type).toBe(MessageType.TxRequest);
    const input = (prev: number, index: number) =>
      concatBytes(
        encodeRepeatedUint32(1, [0x80000054, 0x80000000, 0x80000000, 0, index]),
        encodeBytes(2, new Uint8Array(32).fill(prev)),
        encodeUint32(3, 0),
        encodeUint32(6, InputScriptType.SPENDWITNESS),
        encodeUint32(8, 10000),
      );
    expect((await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(2, input(0x11, 0))))).type).toBe(
      MessageType.TxRequest,
    );
    expect((await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(2, input(0x22, 1))))).type).toBe(
      MessageType.TxRequest,
    );
    const spend = concatBytes(encodeString(1, 'bc1qtest'), encodeUint32(2, 8000));
    expect((await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(5, spend)))).type).toBe(MessageType.TxRequest);
    const change = concatBytes(
      encodeUint32(2, 9000),
      encodeUint32(3, 4),
      encodeRepeatedUint32(4, [0x80000054, 0x80000000, 0x80000000, 1, 0]),
    );
    const button = await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(5, change)));
    expect(button.type).toBe(MessageType.ButtonRequest);
    const done = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(done.type).toBe(MessageType.TxRequest);
    expect(decodeFields(done.payload).filter((field) => field.field === 3)).toHaveLength(2);
  });

  it('signs a taproot key-path input', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    await host.app(MessageType.SignTx, concatBytes(encodeUint32(1, 1), encodeUint32(2, 1)));
    const input = concatBytes(
      encodeRepeatedUint32(1, [0x80000056, 0x80000000, 0x80000000, 0, 0]),
      encodeBytes(2, new Uint8Array(32).fill(0x33)),
      encodeUint32(3, 0),
      encodeUint32(6, InputScriptType.SPENDTAPROOT),
      encodeUint32(8, 12000),
    );
    await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(2, input)));
    const output = concatBytes(encodeString(1, 'bc1ptest'), encodeUint32(2, 10000));
    const button = await host.app(MessageType.TxAck, encodeMessage(1, encodeMessage(5, output)));
    expect(button.type).toBe(MessageType.ButtonRequest);
    const done = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(done.type).toBe(MessageType.TxRequest);
    const serialized = decodeFields(done.payload).find((field) => field.field === 3)?.bytes;
    expect(serialized?.length).toBeGreaterThan(64);
  });

  it('signs EIP-712 Mail through the struct/value loop', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const start = await host.app(
      MessageType.EthereumSignTypedData,
      concatBytes(encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]), encodeString(2, 'Mail')),
    );
    expect(start.type).toBe(MessageType.EthereumTypedDataStructRequest);
    expect(readOptionalString(decodeFields(start.payload), 1)).toBe('EIP712Domain');
    const domainAck = await host.app(
      MessageType.EthereumTypedDataStructAck,
      encodeTypedStructAck([{ name: 'name', dataType: EthereumDataType.STRING }]),
    );
    expect(domainAck.type).toBe(MessageType.EthereumTypedDataStructRequest);
    expect(readOptionalString(decodeFields(domainAck.payload), 1)).toBe('Mail');
    const mailAck = await host.app(
      MessageType.EthereumTypedDataStructAck,
      encodeTypedStructAck([{ name: 'contents', dataType: EthereumDataType.STRING }]),
    );
    expect(mailAck.type).toBe(MessageType.EthereumTypedDataValueRequest);
    const domainValue = await host.app(MessageType.EthereumTypedDataValueAck, encodeTypedValueAck(encodeUtf8('Ether Mail')));
    expect(domainValue.type).toBe(MessageType.EthereumTypedDataValueRequest);
    const messageValue = await host.app(MessageType.EthereumTypedDataValueAck, encodeTypedValueAck(encodeUtf8('hi')));
    expect(messageValue.type).toBe(MessageType.ButtonRequest);
    const done = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(done.type).toBe(MessageType.EthereumTypedDataSignature);
    expect(done.payload.length).toBeGreaterThan(20);
  });

  it('streams Cardano 1-in-1-out to witness 316 then finished 319', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    await host.app(MessageType.ThpEndRequest, new Uint8Array());
    const init = await host.app(
      MessageType.CardanoSignTxInit,
      concatBytes(
        encodeRepeatedUint32(1, [0x8000073c, 0x80000717, 0x80000000, 0, 0]),
        encodeBytes(2, encodeUtf8('cafebabe')),
      ),
    );
    expect(init.type).toBe(MessageType.CardanoTxItemAck);
    const input = await host.app(
      MessageType.CardanoTxInput,
      encodeRepeatedUint32(1, [0x8000073c, 0x80000717, 0x80000000, 0, 0]),
    );
    expect(input.type).toBe(MessageType.CardanoTxItemAck);
    const output = await host.app(MessageType.CardanoTxOutput, concatBytes(encodeString(1, 'addr1test'), encodeUint32(2, 1)));
    expect(output.type).toBe(MessageType.ButtonRequest);
    const witness = await host.app(MessageType.ButtonAck, new Uint8Array());
    expect(witness.type).toBe(MessageType.CardanoTxWitnessResponse);
    expect(witness.type).not.toBe(325);
    const finished = await host.app(MessageType.CardanoTxHostAck, new Uint8Array());
    expect(finished.type).toBe(MessageType.CardanoSignTxFinished);
  });

  it('issues an HMAC credential when the host asks', async () => {
    const host = new ThpHost();
    await host.allocate();
    await host.handshake();
    await host.pair();
    const cred = await host.app(
      MessageType.ThpCredentialRequest,
      encodeCredentialRequest(host.initiator!.hostStatic.publicKey),
    );
    expect(cred.type).toBe(MessageType.ThpCredentialResponse);
  });
});

describe('ETH derivation', () => {
  it('derives the foundry default address', () => {
    const key = derivePrivateKey(entropyFromMnemonic(FOUNDATION), PATH);
    expect(ethereumAddressFromPrivateKey(key).toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });
});

describe('injected rng', () => {
  it('constructs when WebCrypto is missing if rng is injected', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    let n = 1;
    const rng = (length: number) => {
      const out = new Uint8Array(length);
      out.fill(n++ & 0xff);
      return out;
    };
    expect(
      () =>
        new TrezorThpProtocolHandler({
          model: safe7,
          confirmation: autoConfirm(),
          slotId: 'slot',
          entropy: entropyFromMnemonic(FOUNDATION),
          rng,
        }),
    ).not.toThrow();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original });
  });
});
