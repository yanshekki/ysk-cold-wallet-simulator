import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { TREZOR_MODELS, type ConfirmationPort } from '@cws/contracts';
import {
  MessageType,
  TrezorThpProtocolHandler,
  decodeFeatures,
  decodeUsbProtobuf,
  encodeUsbProtobuf,
  hexToBytes,
  splitThpPackets,
} from '@cws/protocol-trezor';
import { ThpClient } from './adapters/thp';
import { bleToHandler } from './ports';
import { startTrezord } from './trezord';

const FOUNDATION = 'test test test test test test test test test test test junk';

function autoConfirm(): ConfirmationPort & { pairingCode: string | null } {
  const port: ConfirmationPort & { pairingCode: string | null } = {
    pairingCode: null,
    async confirm() {
      return true;
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

describe('trezord', () => {
  it('enumerates, acquires, and calls Initialize over HTTP', async () => {
    const confirmation = autoConfirm();
    const model = TREZOR_MODELS.find((item) => item.id === 'safe-7')!;
    const device = new TrezorThpProtocolHandler({
      model,
      confirmation,
      slotId: 'slot',
      entropy: mnemonicToEntropy(FOUNDATION, wordlist),
    });
    const ble = bleToHandler(device, (framed) => splitThpPackets(framed, 20));
    const thp = new ThpClient(ble, () => undefined, async () => confirmation.pairingCode ?? '', 8_000);
    await thp.start();
    const bridge = await startTrezord(thp, model, () => undefined, 0);
    const base = `http://127.0.0.1:${bridge.port}`;
    const version = (await (await fetch(base)).json()) as { version: string };
    expect(version.version).toMatch(/^2\./);
    const listed = (await (await fetch(`${base}/enumerate`, { method: 'POST' })).json()) as Array<{
      path: string;
      vendor: number;
      session: string | null;
    }>;
    expect(listed[0].vendor).toBe(0x1209);
    expect(listed[0].session).toBeNull();
    const acquired = (await (
      await fetch(`${base}/acquire/${encodeURIComponent(listed[0].path)}/null`, { method: 'POST' })
    ).json()) as { session: string };
    expect(acquired.session).toBeTruthy();
    const hex = await (
      await fetch(`${base}/call/${acquired.session}`, {
        method: 'POST',
        body: Buffer.from(encodeUsbProtobuf(MessageType.Initialize, new Uint8Array())).toString('hex'),
      })
    ).text();
    const reply = decodeUsbProtobuf(hexToBytes(hex));
    expect(reply?.type).toBe(MessageType.Features);
    expect(decodeFeatures(reply!.payload).initialized).toBe(true);
    await bridge.close();
    thp.close();
  });
});
