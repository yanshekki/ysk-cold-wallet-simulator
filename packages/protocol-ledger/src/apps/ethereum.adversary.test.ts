import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, type ConfirmationPort } from '@cws/contracts';
import { parseApdu, SW_INS_NOT_SUPPORTED, SW_OK, SW_WRONG_LENGTH, SW_WRONG_P1P2 } from '../apdu';
import { concatBytes } from '../bytes';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { handleEthereumApdu, MAX_PERSONAL_SIGN_BYTES, type EthSession } from './ethereum';

const FOUNDATION = 'test test test test test test test test test test test junk';
const ETH_PATH = [0x8000002c, 0x8000003c, 0x80000000, 0, 0];

function entropyFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

function autoConfirm(): ConfirmationPort {
  return {
    async confirm() {
      return true;
    },
    async getPassphrase() {
      return undefined;
    },
  };
}

function encodePath(components: number[]): Uint8Array {
  const out = new Uint8Array(1 + components.length * 4);
  out[0] = components.length;
  for (let i = 0; i < components.length; i++) {
    const value = components[i] >>> 0;
    const offset = 1 + i * 4;
    out[offset] = (value >>> 24) & 0xff;
    out[offset + 1] = (value >>> 16) & 0xff;
    out[offset + 2] = (value >>> 8) & 0xff;
    out[offset + 3] = value & 0xff;
  }
  return out;
}

function encodeApdu(cla: number, ins: number, p1: number, p2: number, data: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(cla, ins, p1, p2, data.length), data);
}

function statusWord(payload: Uint8Array): number {
  return (payload[payload.length - 2] << 8) | payload[payload.length - 1];
}

function ethCtx(session: EthSession = {}) {
  return {
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: entropyFromMnemonic(FOUNDATION),
    session,
  };
}

async function exchange(handler: LedgerProtocolHandler, apdu: Uint8Array): Promise<Uint8Array | null> {
  const incoming = splitFramedPackets(framePayload(TAG_APDU, apdu, DEFAULT_MTU), DEFAULT_MTU);
  let outgoing: Uint8Array | null = null;
  for (const packet of incoming) {
    outgoing = await handler.handleWrite(packet);
  }
  if (!outgoing) {
    return null;
  }
  const assembler = new BleReassembler();
  let assembled = null;
  for (const packet of splitFramedPackets(outgoing, DEFAULT_MTU)) {
    assembled = assembler.push(packet);
  }
  return assembled?.payload ?? null;
}

describe('ETH adversarial bounds', () => {
  it('rejects personal_sign when the declared length exceeds the cap', async () => {
    const data = concatBytes(encodePath(ETH_PATH), Uint8Array.of(0xff, 0xff, 0xff, 0xff));
    const apdu = parseApdu(encodeApdu(0xe0, 0x08, 0x00, 0x00, data));
    const reply = await handleEthereumApdu(apdu, ethCtx());
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_WRONG_LENGTH);
    expect(MAX_PERSONAL_SIGN_BYTES).toBe(16_384);
  });

  it('rejects GET_ADDRESS with an empty BIP32 path', async () => {
    const apdu = parseApdu(encodeApdu(0xe0, 0x02, 0x00, 0x00, Uint8Array.of(0x00)));
    const reply = await handleEthereumApdu(apdu, ethCtx());
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_WRONG_P1P2);
  });

  it('clears pendingPersonal on resetLink', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    handler.setApp('ethereum');
    const first = concatBytes(encodePath(ETH_PATH), Uint8Array.of(0x00, 0x00, 0x00, 0x0a), Uint8Array.of(0x61));
    expect(await exchange(handler, encodeApdu(0xe0, 0x08, 0x00, 0x00, first))).toBeNull();
    handler.resetLink();
    const cont = await exchange(handler, encodeApdu(0xe0, 0x08, 0x80, 0x00, Uint8Array.of(0x62)));
    expect(cont).not.toBeNull();
    expect(statusWord(cont!)).toBe(SW_WRONG_LENGTH);
  });

  it('returns 6D00 when APDU Lc exceeds the buffer', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    const reply = await exchange(handler, Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x05, 0xaa));
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_INS_NOT_SUPPORTED);
  });

  it('confirms an undecodable short SIGN_TX instead of waiting forever', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    handler.setApp('ethereum');
    const garbage = concatBytes(encodePath(ETH_PATH), Uint8Array.of(0x03, 0xff, 0x00, 0x01));
    const reply = await exchange(handler, encodeApdu(0xe0, 0x04, 0x00, 0x00, garbage));
    expect(reply).not.toBeNull();
    expect(statusWord(reply!)).toBe(SW_OK);
  });

  it('still answers GET_VERSION after a malformed APDU', async () => {
    const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const handler = new LedgerProtocolHandler({
      model: nanoX,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropyFromMnemonic(FOUNDATION),
    });
    await exchange(handler, Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x05, 0xaa));
    const version = await exchange(handler, encodeApdu(0xe0, 0x01, 0x00, 0x00, new Uint8Array()));
    expect(version).not.toBeNull();
    expect(statusWord(version!)).toBe(SW_OK);
  });
});
