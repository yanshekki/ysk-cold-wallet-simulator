import {
  CWS_PERIPHERAL_ID,
  foldBlePeripheralIdWrite,
  type DeviceModel,
  type ProtocolHandler,
} from '@cws/contracts';
import { DEFAULT_MTU, splitNotify } from '@cws/sdk';
import { bleSignHostGate } from './bleSignGate';
import { bytesToHex, hexToBytes } from './hex';
import type { HandlerSource, PeripheralCallbacks } from './types';

export type PeripheralOs = 'android' | 'ios';

export type AdvertiseOptions = {
  serviceUUIDs: string[];
  localName: string;
};

export type BleSubscribeEvent = {
  centralId?: string;
  characteristicUUID?: string;
};

export type BleWriteEvent = {
  value?: string;
  characteristicUUID?: string;
  centralId?: string;
  offset?: number;
  responseRequired?: boolean;
  requestId?: string;
};

export type PeripheralBleOps = {
  startAdvertising: (options: AdvertiseOptions) => void;
  updateCharacteristicValue: (
    serviceUUID: string,
    characteristicUUID: string,
    value: string,
    notify?: boolean,
  ) => Promise<void>;
  respondToPeripheralWriteRequest: (requestId: string, accept: boolean) => Promise<void>;
  setServices?: (services: unknown) => void;
  closeGattServer?: () => void;
};

export type PeripheralLinkOptions = {
  platform: PeripheralOs;
  model: DeviceModel;
  handler: HandlerSource;
  callbacks: PeripheralCallbacks;
  advertiseOptions: AdvertiseOptions;
  ble: PeripheralBleOps;
  notifyGapMs: number;
  delay?: (ms: number) => Promise<void>;
};

/**
 * TransportWebBLE 6.35.0 `open()` writes TAG_MTU immediately after CCCD
 * subscribe. A subscribe that bumps writeEpoch drops that first notify and
 * pushes inferMTU past the 1000 ms pairing workaround, so Chrome disconnects.
 * Only unsubscribe / an explicit host drop invalidates in-flight replies.
 */
export const BUMP_WRITE_EPOCH_ON_SUBSCRIBE = false;

/**
 * Wait for the JS subscribe event before notifying. Chrome may deliver the
 * TAG_MTU write to JS before `peripheralSubscribed` even though native already
 * enabled CCCD. munim 0.9.1 only notifies devices in `subscribedDevices`.
 */
export const SUBSCRIBER_WAIT_MS = 250;

/**
 * Android connectable advertising stops when a central connects. munim 0.9.1
 * (and current munim main `dropServerCentral`) does not restart it on
 * STATE_DISCONNECTED. Restart after the first notify-char subscribe so a later
 * `gatt.connect()` can find the phone. Delay so the first 0x08 notify is out
 * before munim's stop-then-start inside `startAdvertising`.
 */
export const ANDROID_READVERTISE_DELAY_MS = 200;

export function sameBleUuid(left?: string, right?: string): boolean {
  if (!left || !right) {
    return false;
  }
  const normalize = (value: string) => value.replace(/-/g, '').toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.endsWith(b) || b.endsWith(a);
}

export function shouldRestartAdvertising(
  platform: PeripheralOs,
  reason: 'subscribe' | 'unsubscribe',
): boolean {
  void reason;
  return platform === 'android';
}

export function notifyMtuFor(model: DeviceModel, incomingLength: number): number {
  if (model.protocol === 'thp') {
    return Math.max(DEFAULT_MTU, incomingLength);
  }
  return DEFAULT_MTU;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveHandler(handler: HandlerSource): ProtocolHandler {
  return typeof handler === 'function' ? handler() : handler;
}

export type PeripheralLink = {
  readonly writeEpoch: number;
  readonly notifySubscribers: number;
  readonly stopped: boolean;
  onSubscribed: (event: BleSubscribeEvent) => void;
  onUnsubscribed: (event: BleSubscribeEvent) => void;
  onWriteRequest: (event: BleWriteEvent) => Promise<void>;
  stop: () => void;
};

export function createPeripheralLink(options: PeripheralLinkOptions): PeripheralLink {
  const delay = options.delay ?? defaultDelay;
  let writeEpoch = 0;
  let notifySubscribers = 0;
  let stopped = false;
  let idWritePending: Uint8Array | null = null;
  let writeTail = Promise.resolve();
  let readvertiseTimer: ReturnType<typeof setTimeout> | null = null;
  const subscriberWaiters: Array<() => void> = [];

  const flushSubscriberWaiters = () => {
    const waiters = subscriberWaiters.splice(0, subscriberWaiters.length);
    for (const waiter of waiters) {
      waiter();
    }
  };

  const waitForNotifySubscriber = (timeoutMs: number): Promise<boolean> => {
    if (notifySubscribers > 0) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = subscriberWaiters.indexOf(waiter);
        if (index >= 0) {
          subscriberWaiters.splice(index, 1);
        }
        resolve(notifySubscribers > 0);
      }, timeoutMs);
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      subscriberWaiters.push(waiter);
    });
  };

  const queueReadvertise = () => {
    if (stopped || options.platform !== 'android') {
      return;
    }
    if (readvertiseTimer) {
      clearTimeout(readvertiseTimer);
    }
    readvertiseTimer = setTimeout(() => {
      readvertiseTimer = null;
      if (stopped) {
        return;
      }
      options.ble.startAdvertising(options.advertiseOptions);
    }, ANDROID_READVERTISE_DELAY_MS);
  };

  const isNotifyChar = (characteristicUUID?: string) =>
    !characteristicUUID || sameBleUuid(characteristicUUID, options.model.notifyCharUUID);

  const bumpEpochForHostDrop = () => {
    writeEpoch += 1;
    flushSubscriberWaiters();
  };

  const link: PeripheralLink = {
    get writeEpoch() {
      return writeEpoch;
    },
    get notifySubscribers() {
      return notifySubscribers;
    },
    get stopped() {
      return stopped;
    },
    onSubscribed(event) {
      if (stopped) {
        return;
      }
      if (isNotifyChar(event.characteristicUUID)) {
        notifySubscribers += 1;
        flushSubscriberWaiters();
        options.callbacks.onConnected(event.centralId ?? 'host');
        if (shouldRestartAdvertising(options.platform, 'subscribe')) {
          queueReadvertise();
        }
      }
      resolveHandler(options.handler).resetLink?.();
    },
    onUnsubscribed(_event) {
      if (stopped) {
        return;
      }
      bumpEpochForHostDrop();
      if (notifySubscribers > 0) {
        notifySubscribers -= 1;
      }
      bleSignHostGate.setCentral(null);
      resolveHandler(options.handler).resetLink?.();
      options.callbacks.onDisconnected();
      if (shouldRestartAdvertising(options.platform, 'unsubscribe')) {
        queueReadvertise();
      }
    },
    onWriteRequest(event) {
      if (event.responseRequired && event.requestId) {
        void options.ble.respondToPeripheralWriteRequest(event.requestId, true).catch(() => undefined);
      }
      if (sameBleUuid(event.characteristicUUID, CWS_PERIPHERAL_ID.writeCharUUID)) {
        try {
          const chunk = event.value ? hexToBytes(event.value) : new Uint8Array();
          const folded = foldBlePeripheralIdWrite(idWritePending, event.offset ?? 0, chunk);
          idWritePending = folded.pending;
          if (folded.id) {
            options.callbacks.onPeripheralId?.(folded.id);
          }
        } catch {
          idWritePending = null;
        }
        return writeTail;
      }
      const epoch = writeEpoch;
      writeTail = writeTail
        .then(async () => {
          if (stopped || epoch !== writeEpoch) {
            return;
          }
          if (!event.value) {
            return;
          }
          const centralId = event.centralId ?? 'host';
          bleSignHostGate.setCentral(centralId);
          options.callbacks.onConnected(centralId);
          const incoming = hexToBytes(event.value);
          const hex = bytesToHex(incoming);
          options.callbacks.onLog('in', hex, `GATT write ${event.characteristicUUID ?? ''}`.trim());
          bleSignHostGate.beginWrite();
          let outgoing: Uint8Array | null;
          try {
            outgoing = await resolveHandler(options.handler).handleWrite(incoming);
          } finally {
            bleSignHostGate.endWrite();
          }
          if (stopped || epoch !== writeEpoch || !outgoing || outgoing.length === 0) {
            return;
          }
          const subscribed = await waitForNotifySubscriber(SUBSCRIBER_WAIT_MS);
          if (stopped || epoch !== writeEpoch || !subscribed) {
            return;
          }
          const packets = splitNotify(
            options.model,
            outgoing,
            notifyMtuFor(options.model, incoming.length),
          );
          for (let index = 0; index < packets.length; index += 1) {
            if (stopped || epoch !== writeEpoch) {
              return;
            }
            const packet = packets[index];
            const packetHex = bytesToHex(packet);
            options.callbacks.onLog('out', packetHex, 'GATT notify');
            await options.ble.updateCharacteristicValue(
              options.model.serviceUUID,
              options.model.notifyCharUUID,
              packetHex,
              true,
            );
            if (index < packets.length - 1) {
              await delay(options.notifyGapMs);
            }
          }
        })
        .catch((error) => {
          options.callbacks.onLog(
            'out',
            '',
            error instanceof Error ? error.message : 'write handling failed',
          );
        });
      return writeTail;
    },
    stop() {
      stopped = true;
      writeEpoch += 1;
      notifySubscribers = 0;
      flushSubscriberWaiters();
      if (readvertiseTimer) {
        clearTimeout(readvertiseTimer);
        readvertiseTimer = null;
      }
    },
  };
  return link;
}
