import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, type ConfirmationPort } from '@cws/contracts';
import {
  BleReassembler,
  DEFAULT_MTU,
  LedgerProtocolHandler,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  framePayload,
  splitFramedPackets,
  TAG_APDU,
} from '@cws/protocol-ledger';
import { encodeApdu, encodeAscii, statusWord } from './apdu';
import { LAB_ACTIONS, type LabDraft } from './cases';
import type { LabHostLike, LedgerLabApi } from './types';

const FOUNDATION = 'test test test test test test test test test test test junk';
const EMPTY_DRAFT: LabDraft = { path: '', utf8: '', hex: '' };

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

class InProcessLedger implements LedgerLabApi {
  private lastApp = 'BOLOS';

  constructor(private readonly handler: LedgerProtocolHandler) {}

  async send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data: Uint8Array = new Uint8Array(),
    _timeout?: number,
  ): Promise<Uint8Array> {
    const apdu = encodeApdu(cla, ins, p1, p2, data);
    const incoming = splitFramedPackets(framePayload(TAG_APDU, apdu, DEFAULT_MTU), DEFAULT_MTU);
    let outgoing: Uint8Array | null = null;
    for (const packet of incoming) {
      outgoing = await this.handler.handleWrite(packet);
    }
    if (!outgoing) {
      throw new Error('no APDU reply');
    }
    const assembler = new BleReassembler();
    let assembled = null;
    for (const packet of splitFramedPackets(outgoing, DEFAULT_MTU)) {
      assembled = assembler.push(packet);
    }
    if (!assembled) {
      throw new Error('incomplete APDU reply');
    }
    return assembled.payload;
  }

  async sendOk(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Uint8Array,
    note?: string,
  ): Promise<Uint8Array> {
    const payload = await this.send(cla, ins, p1, p2, data);
    const sw = statusWord(payload);
    if (sw !== SW_OK) {
      throw new Error(`${note ?? 'APDU failed'} (${sw.toString(16)})`);
    }
    return payload.subarray(0, payload.length - 2);
  }

  async openApp(name: string, force = false): Promise<void> {
    if (!force && this.lastApp === name) {
      return;
    }
    await this.sendOk(0xe0, 0xd8, 0x00, 0x00, encodeAscii(name), `OPEN_APP ${name}`);
    this.lastApp = name;
  }

  async quitApp(): Promise<void> {
    await this.sendOk(0xb0, 0xa7, 0x00, 0x00, new Uint8Array(), 'QUIT_APP');
    this.lastApp = 'BOLOS';
  }
}

function ledgerHost(): { host: LabHostLike; handler: LedgerProtocolHandler } {
  const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
  const handler = new LedgerProtocolHandler({
    model,
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: mnemonicToEntropy(FOUNDATION, wordlist),
  });
  const ledger = new InProcessLedger(handler);
  return {
    handler,
    host: {
      requireLedger: () => ledger,
      requireOneKey: () => {
        throw new Error('onekey');
      },
      requireTrezor: () => {
        throw new Error('trezor');
      },
    },
  };
}

function action(id: string) {
  const found = LAB_ACTIONS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`missing lab action ${id}`);
  }
  return found;
}

describe('in-process lab actions', () => {
  it('runs dash-version', async () => {
    const { host } = ledgerHost();
    const result = await action('dash-version').run(host, EMPTY_DRAFT);
    expect(result.startsWith('0x')).toBe(true);
  });

  it('runs eth-addr after OPEN_APP', async () => {
    const { host } = ledgerHost();
    const result = await action('eth-addr').run(host, EMPTY_DRAFT);
    expect(result.toLowerCase()).toContain('f39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  });

  it('signs a NEAR NEP-413 message instead of returning 6d00', async () => {
    const { host } = ledgerHost();
    const result = await action('near-sign-message').run(host, {
      path: '',
      utf8: 'hello from near',
      hex: '',
    });
    expect(result).toMatch(/^nep413 64b 0x[0-9a-f]{128}$/);
  });

  it('signs a NEAR NEP-366 delegate instead of returning 6d00', async () => {
    const { host } = ledgerHost();
    const result = await action('near-sign-delegate').run(host, {
      path: '',
      utf8: 'alice.near',
      hex: '',
    });
    expect(result).toMatch(/^nep366 64b 0x[0-9a-f]{128}$/);
  });

  it('refuses eth-garbage instead of signing undecodable bytes', async () => {
    const { host } = ledgerHost();
    await expect(action('eth-garbage').run(host, EMPTY_DRAFT)).rejects.toThrow(/6d00/);
  });

  it('answers malformed APDU with 6D00 without hanging', async () => {
    const { handler } = ledgerHost();
    const framed = framePayload(TAG_APDU, Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x05, 0xaa), DEFAULT_MTU);
    const outgoing = await handler.handleWrite(framed);
    expect(outgoing).not.toBeNull();
    const assembler = new BleReassembler();
    const assembled = assembler.push(outgoing!);
    expect(statusWord(assembled!.payload)).toBe(SW_INS_NOT_SUPPORTED);
  });
});
