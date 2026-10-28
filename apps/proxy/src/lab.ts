import type { Brand } from '@cws/contracts';
import {
  BleReassembler,
  DEFAULT_MTU as LEDGER_MTU,
  framePayload,
  splitFramedPackets,
  TAG_APDU,
} from '@cws/protocol-ledger';
import {
  DEFAULT_MTU as ONEKEY_MTU,
  FailureType as OneKeyFailureType,
  MessageType as OneKeyMessageType,
  V1Reassembler,
  decodeFailure as decodeOneKeyFailure,
  frameV1,
  splitOneKeyV1,
} from '@cws/protocol-onekey';
import {
  FailureType as TrezorFailureType,
  MessageType as TrezorMessageType,
  decodeFailure as decodeTrezorFailure,
} from '@cws/protocol-trezor';
import {
  LAB_ACTIONS,
  listLabCatalog,
  type LabAction,
  type LabCatalogSection,
  type LabDraft,
} from './catalog/cases';
import { assertOk, encodeApdu } from './catalog/apdu';
import { NEAR_FAUCET } from './catalog/rpc';
import type { LabHostLike } from './catalog/types';
import type { ThpClient } from './adapters/thp';
import type { LogFn } from './log';
import { PacketQueue } from './packets';
import type { AdapterHandle, BlePort, ExclusiveLock, NotifyRouter } from './ports';

const SIGN_TIMEOUT_MS = 180_000;

export type LabCatalog = {
  ready: boolean;
  brand: Brand;
  connectedBrand: Brand | null;
  sections: LabCatalogSection[];
  nearFaucet: string;
};

const BRANDS: Brand[] = ['ledger', 'onekey', 'trezor'];

export function parseLabBrand(value: string | null | undefined): Brand | undefined {
  return BRANDS.find((brand) => brand === value);
}

export type LabDraftInput = {
  path?: string;
  utf8?: string;
  hex?: string;
};

export type LabHandle = {
  run(actionId: string, draft?: LabDraftInput): Promise<string>;
  close(): void;
};

export function labCatalogFor(
  brand: Brand | null,
  ready: boolean,
  connectedBrand: Brand | null = brand,
): LabCatalog {
  const selected = brand ?? connectedBrand ?? 'ledger';
  return {
    ready: ready && connectedBrand === selected,
    brand: selected,
    connectedBrand,
    sections: listLabCatalog(selected),
    nearFaucet: NEAR_FAUCET,
  };
}

export function createLabHandle(opts: {
  brand: Brand;
  ble: BlePort;
  router: NotifyRouter;
  exclusive: ExclusiveLock;
  log: LogFn;
  adapter: () => AdapterHandle | undefined;
  thp?: ThpClient;
}): LabHandle {
  let closed = false;
  let lastApp: string | null = null;
  const ledgerMtu = LEDGER_MTU;
  const host: LabHostLike = {
    requireLedger() {
      if (opts.brand !== 'ledger') {
        throw new Error('Connect a Ledger model first');
      }
      return {
        send: (cla, ins, p1, p2, data, timeout) => sendLedger(cla, ins, p1, p2, data, timeout),
        sendOk: async (cla, ins, p1, p2, data, note) =>
          assertOk(await sendLedger(cla, ins, p1, p2, data), note),
        openApp: async (name, force = false) => {
          if (!force && lastApp === name) {
            return;
          }
          await assertOk(
            await sendLedger(0xe0, 0xd8, 0x00, 0x00, ascii(name)),
            `OPEN_APP ${name}`,
          );
          lastApp = name;
          opts.adapter()?.setOpenAppName(name);
        },
        quitApp: async () => {
          await assertOk(await sendLedger(0xb0, 0xa7, 0x00, 0x00), 'QUIT_APP');
          lastApp = 'BOLOS';
          opts.adapter()?.setOpenAppName('BOLOS');
        },
      };
    },
    requireOneKey() {
      if (opts.brand !== 'onekey') {
        throw new Error('Connect a OneKey model first');
      }
      return {
        call: (type, payload) => callOneKey(type, payload),
      };
    },
    requireTrezor() {
      if (opts.brand !== 'trezor') {
        throw new Error('Connect a Trezor Safe 7 first');
      }
      return {
        call: (type, payload) => callTrezor(type, payload),
        app: (type, payload) => rawTrezor(type, payload),
      };
    },
  };

  async function withLabExclusive<T>(useHijack: boolean, task: (queue: PacketQueue) => Promise<T>): Promise<T> {
    return opts.exclusive.run(async () => {
      const adapter = opts.adapter();
      adapter?.setLabAwaiting(true);
      const queue = new PacketQueue();
      const release = useHijack ? opts.router.hijack((packet) => queue.push(packet)) : () => undefined;
      try {
        return await task(queue);
      } finally {
        release();
        queue.reset();
        adapter?.setLabAwaiting(false);
      }
    });
  }

  async function sendLedger(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data: Uint8Array = new Uint8Array(),
    timeout = SIGN_TIMEOUT_MS,
  ): Promise<Uint8Array> {
    const apdu = encodeApdu(cla, ins, p1, p2, data);
    const framed = framePayload(TAG_APDU, apdu, ledgerMtu);
    const packets = splitFramedPackets(framed, ledgerMtu);
    const assembler = new BleReassembler();
    return withLabExclusive(true, async (queue) => {
      for (const packet of packets) {
        opts.log(`ble => ${preview(packet)}`);
        await opts.ble.write(packet);
      }
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const packet = await queue.next(deadline - Date.now());
        opts.log(`ble <= ${preview(packet)}`);
        const frame = assembler.push(packet);
        if (frame) {
          return frame.payload;
        }
      }
      throw new Error('BLE timeout waiting for notify');
    });
  }

  async function rpcOneKey(
    type: number,
    payload: Uint8Array,
    timeout = SIGN_TIMEOUT_MS,
  ): Promise<{ type: number; payload: Uint8Array }> {
    const framed = frameV1(type, payload);
    const assembler = new V1Reassembler();
    return withLabExclusive(true, async (queue) => {
      for (const packet of splitOneKeyV1(framed, ONEKEY_MTU)) {
        opts.log(`ble => ${preview(packet)}`);
        await opts.ble.write(packet);
      }
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const packet = await queue.next(deadline - Date.now());
        opts.log(`ble <= ${preview(packet)}`);
        const message = assembler.push(packet);
        if (message) {
          return message;
        }
      }
      throw new Error('BLE timeout waiting for notify');
    });
  }

  async function callOneKey(type: number, payload: Uint8Array): Promise<{ type: number; payload: Uint8Array }> {
    const first = await rpcOneKey(type, payload);
    if (first.type === OneKeyMessageType.ButtonRequest) {
      const next = await rpcOneKey(OneKeyMessageType.ButtonAck, new Uint8Array());
      if (next.type === OneKeyMessageType.Failure) {
        throw oneKeyFailure(next.payload);
      }
      return next;
    }
    if (first.type === OneKeyMessageType.Failure) {
      throw oneKeyFailure(first.payload);
    }
    return first;
  }

  async function rawTrezor(type: number, payload: Uint8Array): Promise<{ type: number; payload: Uint8Array }> {
    const thp = opts.thp;
    if (!thp) {
      throw new Error('THP handshake not ready');
    }
    return withLabExclusive(false, () => thp.app(type, payload));
  }

  async function callTrezor(type: number, payload: Uint8Array): Promise<{ type: number; payload: Uint8Array }> {
    const thp = opts.thp;
    if (!thp) {
      throw new Error('THP handshake not ready');
    }
    return withLabExclusive(false, async () => {
      const first = await thp.app(type, payload);
      if (first.type === TrezorMessageType.ButtonRequest) {
        const next = await thp.app(TrezorMessageType.ButtonAck, new Uint8Array());
        if (next.type === TrezorMessageType.Failure) {
          throw trezorFailure(next.payload);
        }
        return next;
      }
      if (first.type === TrezorMessageType.Failure) {
        throw trezorFailure(first.payload);
      }
      return first;
    });
  }

  return {
    async run(actionId, draft) {
      if (closed) {
        throw new Error('lab session closed');
      }
      const action = LAB_ACTIONS.find((item) => item.id === actionId && item.brand === opts.brand);
      if (!action) {
        throw new Error(`unknown lab action ${actionId}`);
      }
      return action.run(host, mergeDraft(action, draft));
    },
    close() {
      closed = true;
    },
  };
}

function mergeDraft(action: LabAction, draft?: LabDraftInput): LabDraft {
  return {
    path: draft?.path ?? action.editor?.path ?? '',
    utf8: draft?.utf8 ?? action.editor?.utf8 ?? '',
    hex: draft?.hex ?? action.editor?.hex ?? '',
  };
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function preview(bytes: Uint8Array): string {
  const take = Math.min(bytes.length, 12);
  let hex = '';
  for (let i = 0; i < take; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `${bytes.length}b ${hex}`;
}

function oneKeyFailure(payload: Uint8Array): Error {
  const decoded = decodeOneKeyFailure(payload);
  const label = decoded.code === OneKeyFailureType.UnexpectedMessage ? 'Unsupported' : decoded.message;
  return new Error(label || `OneKey failure ${decoded.code}`);
}

function trezorFailure(payload: Uint8Array): Error {
  const decoded = decodeTrezorFailure(payload);
  const label =
    decoded.code === TrezorFailureType.UnexpectedMessage ? decoded.message || 'Unsupported' : decoded.message;
  return new Error(label || `Trezor failure ${decoded.code}`);
}
