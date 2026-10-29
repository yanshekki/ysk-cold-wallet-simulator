import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { blake2b } from '@noble/hashes/blake2b';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_MODELS,
  catalogVersion,
  resetLedgerVersionPicks,
  setLedgerVersionPicks,
  type ConfirmationPort,
} from '@cws/contracts';
import { SW_DENY, SW_INS_NOT_SUPPORTED, SW_OK, SW_WRONG_P1P2 } from '../apdu';
import { deriveEd25519PrivateKey, signEd25519 } from '../crypto';
import { BleReassembler, DEFAULT_MTU, framePayload, splitFramedPackets, TAG_APDU } from '../framing';
import { LedgerProtocolHandler } from '../handler';
import { deriveIcarus, signIcarus } from './icarus';

const FOUNDATION = 'test test test test test test test test test test test junk';

function entropy(): Uint8Array {
  return mnemonicToEntropy(FOUNDATION, wordlist);
}

function handler(confirm?: ConfirmationPort['confirm']): {
  device: LedgerProtocolHandler;
  confirms: () => number;
} {
  let seen = 0;
  const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
  const device = new LedgerProtocolHandler({
    model: nanoX,
    confirmation: {
      async confirm(request) {
        seen += 1;
        if (confirm) {
          return confirm(request);
        }
        return true;
      },
      async getPassphrase() {
        return undefined;
      },
    },
    slotId: 'slot',
    entropy: entropy(),
  });
  return { device, confirms: () => seen };
}

function apdu(bytes: number[]): Uint8Array {
  return framePayload(TAG_APDU, Uint8Array.from(bytes), DEFAULT_MTU);
}

async function exchange(device: LedgerProtocolHandler, framed: Uint8Array): Promise<Uint8Array> {
  const incoming = splitFramedPackets(framed, DEFAULT_MTU);
  let outgoing: Uint8Array | null = null;
  for (const packet of incoming) {
    outgoing = await device.handleWrite(packet);
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

function statusOf(payload: Uint8Array): number {
  return (payload[payload.length - 2]! << 8) | payload[payload.length - 1]!;
}

function bodyOf(payload: Uint8Array): Uint8Array {
  return payload.subarray(0, payload.length - 2);
}

function encodePath(components: number[]): number[] {
  const out = [components.length];
  for (const component of components) {
    out.push((component >>> 24) & 0xff, (component >>> 16) & 0xff, (component >>> 8) & 0xff, component & 0xff);
  }
  return out;
}

const ADA_PATH = [0x8000073c, 0x80000717, 0x80000000, 0, 0];
const SOL_PATH = [0x8000002c, 0x800001f5, 0x80000000];

describe('Cardano SIGN_TX body lengths follow the reported app version', () => {
  it('v8 INIT is empty 9000 and does not open the confirm sheet', async () => {
    expect(catalogVersion('cardano', '0').split('.')[0]).toBe('8');
    const { device, confirms } = handler();
    device.setApp('cardano');
    const init = await exchange(device, apdu([0xd7, 0x21, 0x10, 0x00, 0x08, 0, 0, 0, 0, 0, 0, 0, 1]));
    expect(statusOf(init)).toBe(SW_OK);
    expect(bodyOf(init).length).toBe(0);
    expect(confirms()).toBe(0);
    const chunk = await exchange(device, apdu([0xd7, 0x21, 0x11, 0x00, 0x02, 0xaa, 0xbb]));
    expect(bodyOf(chunk).length).toBe(0);
    expect(confirms()).toBe(0);
  });

  it('v8 CONFIRM returns 32 bytes and WITNESS returns a 64-byte signature of that hash', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    await exchange(device, apdu([0xd7, 0x21, 0x10, 0x00, 0x01, 0x03]));
    const raw = Uint8Array.of(0x11, 0x22, 0x33, 0x44);
    const confirmed = await exchange(device, apdu([0xd7, 0x21, 0x12, 0x00, raw.length, ...raw]));
    expect(statusOf(confirmed)).toBe(SW_OK);
    expect(bodyOf(confirmed).length).toBe(32);
    expect(Array.from(bodyOf(confirmed))).toEqual(Array.from(blake2b(raw, { dkLen: 32 })));
    expect(confirms()).toBe(1);

    const pathBytes = encodePath(ADA_PATH);
    const witness = await exchange(device, apdu([0xd7, 0x21, 0x0f, 0x00, pathBytes.length, ...pathBytes]));
    expect(statusOf(witness)).toBe(SW_OK);
    expect(bodyOf(witness).length).toBe(64);
    expect(confirms()).toBe(2);
    const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    expect(Array.from(bodyOf(witness))).toEqual(Array.from(signIcarus(node, bodyOf(confirmed))));
  });

  it('v8 does not treat v7 confirm P1 0x0A as a 32-byte hash', async () => {
    const { device, confirms } = handler();
    device.setApp('cardano');
    const reply = await exchange(device, apdu([0xd7, 0x21, 0x0a, 0x00, 0x00]));
    expect(statusOf(reply)).toBe(SW_WRONG_P1P2);
    expect(bodyOf(reply).length).toBe(0);
    expect(confirms()).toBe(0);
  });

  it('v7 uses different P1 values for the same empty, 32, and 64 byte replies', async () => {
    setLedgerVersionPicks({ cardano: '7.2.1' });
    try {
      expect(catalogVersion('cardano', '0')).toBe('7.2.1');
      const { device, confirms } = handler();
      device.setApp('cardano');
      const version = await exchange(device, apdu([0xd7, 0x00, 0x00, 0x00, 0x00]));
      expect(Array.from(bodyOf(version))).toEqual([7, 2, 1, 0]);

      const init = await exchange(device, apdu([0xd7, 0x21, 0x01, 0x00, 0x02, 0x10, 0x20]));
      expect(bodyOf(init).length).toBe(0);
      expect(confirms()).toBe(0);
      // These P1 values are v8 INIT / CHUNK / CONFIRM. On v7 they are empty stages.
      for (const p1 of [0x10, 0x11, 0x12]) {
        const stage = await exchange(device, apdu([0xd7, 0x21, p1, 0x00, 0x01, 0x7f]));
        expect(bodyOf(stage).length).toBe(0);
        expect(confirms()).toBe(0);
      }
      const confirmed = await exchange(device, apdu([0xd7, 0x21, 0x0a, 0x00, 0x00]));
      expect(statusOf(confirmed)).toBe(SW_OK);
      expect(bodyOf(confirmed).length).toBe(32);
      expect(confirms()).toBe(1);
      const uploaded = Uint8Array.of(0x10, 0x20, 0x7f, 0x7f, 0x7f);
      expect(Array.from(bodyOf(confirmed))).toEqual(Array.from(blake2b(uploaded, { dkLen: 32 })));

      const pathBytes = encodePath(ADA_PATH);
      const witness = await exchange(device, apdu([0xd7, 0x21, 0x0f, 0x00, pathBytes.length, ...pathBytes]));
      expect(bodyOf(witness).length).toBe(64);
      const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
      expect(Array.from(bodyOf(witness))).toEqual(Array.from(signIcarus(node, bodyOf(confirmed))));
    } finally {
      resetLedgerVersionPicks();
    }
  });

  it('v7 CIP-36 aux confirm is not a 64-byte witness', async () => {
    setLedgerVersionPicks({ cardano: '7.2.1' });
    try {
      const { device } = handler();
      device.setApp('cardano');
      const reply = await exchange(device, apdu([0xd7, 0x21, 0x08, 0x34, 0x00]));
      expect(statusOf(reply)).toBe(SW_INS_NOT_SUPPORTED);
      expect(bodyOf(reply).length).toBe(0);
    } finally {
      resetLedgerVersionPicks();
    }
  });

  it('a denied v8 confirm returns 6985 and no hash', async () => {
    const { device } = handler(async () => false);
    device.setApp('cardano');
    await exchange(device, apdu([0xd7, 0x21, 0x10, 0x00, 0x01, 0x01]));
    const denied = await exchange(device, apdu([0xd7, 0x21, 0x12, 0x00, 0x01, 0x02]));
    expect(statusOf(denied)).toBe(SW_DENY);
    expect(bodyOf(denied).length).toBe(0);
    const pathBytes = encodePath(ADA_PATH);
    const witness = await exchange(device, apdu([0xd7, 0x21, 0x0f, 0x00, pathBytes.length, ...pathBytes]));
    expect(statusOf(witness)).toBe(SW_WRONG_P1P2);
    expect(bodyOf(witness).length).toBe(0);
  });
});

describe('Solana SIGN_MESSAGE chunk ACKs', () => {
  function solanaHead(message: number[]): number[] {
    const path = encodePath(SOL_PATH);
    return [0x01, ...path, ...message];
  }

  it('a first chunk from the dashboard is Solana, empty 9000, and does not open a sheet', async () => {
    const { device, confirms } = handler();
    expect(device.getApp()).toBe('dashboard');
    const head = solanaHead([0x11, 0x22, 0x33, 0x44]);
    const more = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x02, head.length, ...head]));
    expect(device.getApp()).toBe('solana');
    expect(statusOf(more)).toBe(SW_OK);
    expect(bodyOf(more).length).toBe(0);
    expect(confirms()).toBe(0);

    const rest = [0x55, 0x66];
    const signed = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x01, rest.length, ...rest]));
    expect(statusOf(signed)).toBe(SW_OK);
    expect(bodyOf(signed).length).toBe(64);
    expect(confirms()).toBe(1);
    const message = Uint8Array.of(0x11, 0x22, 0x33, 0x44, 0x55, 0x66);
    const key = deriveEd25519PrivateKey(entropy(), "m/44'/501'/0'");
    expect(Array.from(bodyOf(signed))).toEqual(Array.from(signEd25519(key, message)));
  });

  it('does not answer a Solana sign chunk with the Ethereum version', async () => {
    const { device, confirms } = handler();
    device.setApp('ethereum');
    const head = solanaHead([0x01]);
    const more = await exchange(device, apdu([0xe0, 0x06, 0x01, 0x02, head.length, ...head]));
    expect(device.getApp()).toBe('solana');
    expect(bodyOf(more).length).toBe(0);
    expect(confirms()).toBe(0);

    const version = await exchange(device, apdu([0xe0, 0x06, 0x00, 0x00, 0x00]));
    expect(device.getApp()).toBe('tron');
    expect(bodyOf(version).length).toBe(4);
  });

  it('keeps an empty E0 06 on Ethereum as GET_APP_CONFIGURATION', async () => {
    const { device, confirms } = handler();
    device.setApp('ethereum');
    const version = await exchange(device, apdu([0xe0, 0x06, 0x00, 0x00, 0x00]));
    expect(device.getApp()).toBe('ethereum');
    expect(bodyOf(version).length).toBe(4);
    expect(confirms()).toBe(0);
  });
});
