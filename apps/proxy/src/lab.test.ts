import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, type ConfirmationPort } from '@cws/contracts';
import {
  DEFAULT_MTU,
  LedgerProtocolHandler,
  SW_OK,
  splitFramedPackets,
  unwrapHidReports,
  wrapHidApdu,
} from '@cws/protocol-ledger';
import { attachLedger } from './adapters/ledger';
import { createLabHandle, labCatalogFor } from './lab';
import { bleToHandler, createExclusive, createNotifyRouter, memoryHidPair, type BlePort } from './ports';

const FOUNDATION = 'test test test test test test test test test test test junk';

function entropy(): Uint8Array {
  return mnemonicToEntropy(FOUNDATION, wordlist);
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

function routeBle(ble: BlePort) {
  const router = createNotifyRouter();
  ble.onNotify((packet) => router.dispatch(packet));
  return {
    router,
    port: {
      write: (packet: Uint8Array) => ble.write(packet),
      onNotify: (callback: (packet: Uint8Array) => void) => router.subscribe(callback),
      close: () => ble.close(),
    },
  };
}

describe('proxy lab', () => {
  it('lists dash-version on the ledger catalog', () => {
    const catalog = labCatalogFor('ledger', true);
    expect(catalog.ready).toBe(true);
    expect(catalog.sections.some((section) => section.actions.some((action) => action.id === 'dash-version'))).toBe(
      true,
    );
  });

  it('runs dash-version over GATT without writing HID', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    const exclusive = createExclusive();
    const raw = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const routed = routeBle(raw);
    const logs: string[] = [];
    const adapter = attachLedger(gadget, routed.port, DEFAULT_MTU, (line) => logs.push(line), model.id, exclusive);
    const hidReplies: Uint8Array[] = [];
    host.onInput((report) => hidReplies.push(report));
    const lab = createLabHandle({
      brand: 'ledger',
      ble: routed.port,
      router: routed.router,
      exclusive,
      log: (line) => logs.push(line),
      adapter: () => adapter,
    });

    const result = await lab.run('dash-version');
    expect(result.startsWith('0x')).toBe(true);
    expect(result.length).toBeGreaterThan(2);
    expect(hidReplies).toEqual([]);
    expect(logs.some((line) => line.startsWith('ble =>'))).toBe(true);
    expect(logs.some((line) => line.startsWith('ble <='))).toBe(true);
    expect(logs.some((line) => line.includes('dropped extra'))).toBe(false);

    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(hidReplies).payload;
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);

    adapter.close();
    lab.close();
  });
});
