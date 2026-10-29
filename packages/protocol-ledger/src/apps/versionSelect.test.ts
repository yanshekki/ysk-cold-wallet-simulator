import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEDGER_MODELS,
  catalogVersion,
  resetLedgerVersionPicks,
  setLedgerVersionPicks,
  type ConfirmationPort,
} from '@cws/contracts';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { parseAppAndVersion } from './dashboard';

const FOUNDATION = 'test test test test test test test test test test test junk';

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

function apdu(bytes: number[]): Uint8Array {
  return framePayload(TAG_APDU, Uint8Array.from(bytes), DEFAULT_MTU);
}

async function exchange(handler: LedgerProtocolHandler, framed: Uint8Array): Promise<Uint8Array> {
  const incoming = splitFramedPackets(framed, DEFAULT_MTU);
  let outgoing: Uint8Array | null = null;
  for (const packet of incoming) {
    outgoing = await handler.handleWrite(packet);
  }
  expect(outgoing).not.toBeNull();
  const assembler = new BleReassembler();
  let assembled = null;
  for (const packet of splitFramedPackets(outgoing!, DEFAULT_MTU)) {
    assembled = assembler.push(packet);
  }
  expect(assembled).not.toBeNull();
  return assembled!.payload;
}

afterEach(() => {
  resetLedgerVersionPicks();
});

describe('selected Ledger app version', () => {
  it('reports the pick on Cardano GET_VERSION and GET_APP_AND_VERSION', async () => {
    expect(catalogVersion('cardano', '0')).toBe('8.0.8');
    setLedgerVersionPicks({ cardano: '7.2.1' });
    const handler = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((model) => model.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: mnemonicToEntropy(FOUNDATION, wordlist),
    });

    const version = await exchange(handler, apdu([0xd7, 0x00, 0x00, 0x00, 0x00]));
    expect(handler.getApp()).toBe('cardano');
    const body = version.subarray(0, version.length - 2);
    expect(Array.from(body)).toEqual([7, 2, 1, 0x00]);

    const named = await exchange(handler, apdu([0xb0, 0x01, 0x00, 0x00, 0x00]));
    const parsed = parseAppAndVersion(named);
    expect(parsed?.name).toBe('Cardano ADA');
    expect(parsed?.version).toBe('7.2.1');

    handler.setApp('dashboard');
    const os = await exchange(handler, apdu([0xe0, 0x01, 0x00, 0x00, 0x00]));
    const seLen = os[4] ?? 0;
    const se = Array.from(os.slice(5, 5 + seLen), (byte) => String.fromCharCode(byte)).join('');
    expect(se).toBe('2.7.1');
    expect(catalogVersion('ethereum', '0')).toBe('1.22.5');
  });
});
