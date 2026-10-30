import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { TREZOR_MODELS, type ConfirmationPort } from '@cws/contracts';

import {
  ButtonRequestType,
  MessageType,
  TrezorThpProtocolHandler,
  decodeButtonRequest,
  decodeEthereumAddress,
  decodeFeatures,
  decodeUsbProtobuf,
  encodeRepeatedUint32,
  encodeUint32,
  encodeUsbProtobuf,
  hexToBytes,
  splitThpPackets,
} from '@cws/protocol-trezor';
import { ThpClient } from './adapters/thp';
import { bleToHandler } from './ports';
import { startTrezord } from './trezord';

const FOUNDATION = 'test test test test test test test test test test test junk';

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

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
    const address = concatBytes(
      encodeRepeatedUint32(1, [0x8000002c, 0x8000003c, 0x80000000, 0, 0]),
      encodeUint32(2, 1),
    );
    const call = async (type: number, payload: Uint8Array) => {
      const body = await (
        await fetch(`${base}/call/${acquired.session}`, {
          method: 'POST',
          body: Buffer.from(encodeUsbProtobuf(type, payload)).toString('hex'),
        })
      ).text();
      const decoded = decodeUsbProtobuf(hexToBytes(body));
      if (!decoded) {
        throw new Error('empty trezord reply');
      }
      return decoded;
    };
    const button = await call(MessageType.EthereumGetAddress, address);
    expect(button.type).toBe(MessageType.ButtonRequest);
    expect(decodeButtonRequest(button.payload)).toBe(ButtonRequestType.Address);
    const signed = await call(MessageType.ButtonAck, new Uint8Array());
    expect(signed.type).toBe(MessageType.EthereumAddress);
    expect(decodeEthereumAddress(signed.payload).toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    await bridge.close();
    thp.close();
  });
});
