import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEDGER_MODELS, bytesToHex, type ProtocolHandler } from '@cws/contracts';
import { LedgerProtocolHandler, TAG_MTU, framePayload, DEFAULT_MTU } from '@cws/protocol-ledger';
import {
  ANDROID_READVERTISE_DELAY_MS,
  BUMP_WRITE_EPOCH_ON_SUBSCRIBE,
  SUBSCRIBER_WAIT_MS,
  createPeripheralLink,
  shouldRestartAdvertising,
  type AdvertiseOptions,
  type PeripheralBleOps,
  type PeripheralLinkOptions,
} from './peripheralLink';
import { bleSignHostGate } from './bleSignGate';

const nanoX = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
const TAG_MTU_WRITE = '0800000000';
const TAG_MTU_NOTIFY = '080000000114';

function autoConfirm() {
  return {
    async confirm() {
      return true;
    },
    async getPassphrase() {
      return undefined;
    },
  };
}

function ledgerMtuHandler(): ProtocolHandler {
  return new LedgerProtocolHandler({
    model: nanoX,
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: new Uint8Array(16),
  });
}

function stubHandler(handleWrite: ProtocolHandler['handleWrite']): ProtocolHandler {
  return {
    brand: 'ledger',
    models: ['nano-x'],
    getServiceUUID: () => nanoX.serviceUUID,
    getCharacteristics: () => ({
      write: nanoX.writeCharUUID,
      notify: nanoX.notifyCharUUID,
    }),
    handleWrite,
  };
}

function createBle() {
  const notifies: string[] = [];
  const advertising: AdvertiseOptions[] = [];
  const ble: PeripheralBleOps = {
    startAdvertising: (options) => {
      advertising.push(options);
    },
    updateCharacteristicValue: async (_service, _char, value) => {
      notifies.push(value);
    },
    respondToPeripheralWriteRequest: vi.fn(async () => undefined),
    setServices: vi.fn(),
    closeGattServer: vi.fn(),
  };
  return { ble, notifies, advertising };
}

function createCallbacks() {
  const connected: string[] = [];
  const state = { disconnected: 0 };
  return {
    connected,
    state,
    callbacks: {
      onConnected: (id: string) => {
        connected.push(id);
      },
      onDisconnected: () => {
        state.disconnected += 1;
      },
      onLog: () => undefined,
    },
  };
}

function openLink(
  platform: 'android' | 'ios',
  overrides?: Partial<PeripheralLinkOptions> & { handler?: ProtocolHandler },
) {
  const { ble, notifies, advertising } = createBle();
  const { callbacks, connected, state } = createCallbacks();
  const handler = overrides?.handler ?? ledgerMtuHandler();
  const link = createPeripheralLink({
    platform,
    model: nanoX,
    handler,
    callbacks,
    advertiseOptions: { serviceUUIDs: [nanoX.serviceUUID], localName: 'Nano X' },
    ble,
    notifyGapMs: 0,
    ...overrides,
  });
  return {
    link,
    ble,
    notifies,
    advertising,
    connected,
    disconnected: () => state.disconnected,
    handler,
  };
}

describe('Ledger TAG_MTU stay-up policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bleSignHostGate.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    bleSignHostGate.reset();
  });

  it('does not bump writeEpoch on subscribe', () => {
    expect(BUMP_WRITE_EPOCH_ON_SUBSCRIBE).toBe(false);
  });

  it('frames GET_MTU as 08 00 00 00 01 14', () => {
    const framed = framePayload(TAG_MTU, Uint8Array.of(DEFAULT_MTU), DEFAULT_MTU);
    expect(bytesToHex(framed)).toBe(TAG_MTU_NOTIFY);
  });

  it('notifies the first 0x08 reply when subscribe arrives during the write', async () => {
    const { link, notifies } = openLink('android');
    const write = link.onWriteRequest({
      value: TAG_MTU_WRITE,
      characteristicUUID: nanoX.writeCharUUID,
      centralId: 'chrome',
    });
    expect(link.writeEpoch).toBe(0);
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    expect(link.writeEpoch).toBe(0);
    await write;
    expect(notifies).toEqual([TAG_MTU_NOTIFY]);
  });

  it('waits for a subscriber before the first notify', async () => {
    const { link, notifies } = openLink('android');
    const write = link.onWriteRequest({
      value: TAG_MTU_WRITE,
      characteristicUUID: nanoX.writeCharUUID,
      centralId: 'chrome',
    });
    await vi.advanceTimersByTimeAsync(SUBSCRIBER_WAIT_MS - 10);
    expect(notifies).toEqual([]);
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    await write;
    expect(notifies).toEqual([TAG_MTU_NOTIFY]);
  });

  it('does not notify TAG_MTU if no subscriber arrives', async () => {
    const { link, notifies } = openLink('android');
    const write = link.onWriteRequest({
      value: TAG_MTU_WRITE,
      characteristicUUID: nanoX.writeCharUUID,
      centralId: 'chrome',
    });
    await vi.advanceTimersByTimeAsync(SUBSCRIBER_WAIT_MS + 10);
    await write;
    expect(notifies).toEqual([]);
  });

  it('keeps the first 0x08 notify across an Android reconnect without unsubscribe', async () => {
    const { link, notifies, advertising } = openLink('android');
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    await link.onWriteRequest({
      value: TAG_MTU_WRITE,
      characteristicUUID: nanoX.writeCharUUID,
      centralId: 'chrome',
    });
    expect(notifies).toEqual([TAG_MTU_NOTIFY]);
    await vi.advanceTimersByTimeAsync(ANDROID_READVERTISE_DELAY_MS);
    expect(advertising).toHaveLength(1);

    const reconnect = link.onWriteRequest({
      value: TAG_MTU_WRITE,
      characteristicUUID: nanoX.writeCharUUID,
      centralId: 'chrome',
    });
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    expect(link.writeEpoch).toBe(0);
    await reconnect;
    expect(notifies).toEqual([TAG_MTU_NOTIFY, TAG_MTU_NOTIFY]);
  });

  it('invalidates in-flight notifies on unsubscribe', async () => {
    let release: (value: Uint8Array) => void = () => undefined;
    const handler = stubHandler(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = resolve;
        }),
    );
    const { link, notifies } = openLink('ios', { handler });
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'host',
    });
    const write = link.onWriteRequest({
      value: TAG_MTU_WRITE,
      characteristicUUID: nanoX.writeCharUUID,
      centralId: 'host',
    });
    link.onUnsubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'host',
    });
    release(framePayload(TAG_MTU, Uint8Array.of(DEFAULT_MTU), DEFAULT_MTU));
    await write;
    expect(notifies).toEqual([]);
    expect(link.writeEpoch).toBe(1);
  });

  it('restarts Android advertising after subscribe without tearing the GATT server down', async () => {
    const { link, ble, advertising } = openLink('android');
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    expect(advertising).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(ANDROID_READVERTISE_DELAY_MS);
    expect(advertising).toEqual([{ serviceUUIDs: [nanoX.serviceUUID], localName: 'Nano X' }]);
    expect(ble.setServices).not.toHaveBeenCalled();
    expect(ble.closeGattServer).not.toHaveBeenCalled();
  });

  it('restarts Android advertising after unsubscribe without setServices', async () => {
    const { link, ble, advertising, disconnected } = openLink('android');
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    await vi.advanceTimersByTimeAsync(ANDROID_READVERTISE_DELAY_MS);
    link.onUnsubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    await vi.advanceTimersByTimeAsync(ANDROID_READVERTISE_DELAY_MS);
    expect(disconnected()).toBe(1);
    expect(advertising).toHaveLength(2);
    expect(ble.setServices).not.toHaveBeenCalled();
    expect(ble.closeGattServer).not.toHaveBeenCalled();
  });

  it('does not restart iOS advertising on subscribe so CoreBluetooth stays up', async () => {
    expect(shouldRestartAdvertising('ios', 'subscribe')).toBe(false);
    expect(shouldRestartAdvertising('android', 'subscribe')).toBe(true);
    const { link, advertising, connected } = openLink('ios');
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'iphone-host',
    });
    await vi.advanceTimersByTimeAsync(ANDROID_READVERTISE_DELAY_MS);
    expect(advertising).toHaveLength(0);
    expect(connected).toEqual(['iphone-host']);
  });

  it('still reports iOS disconnect on unsubscribe and does not close the GATT server', async () => {
    const { link, ble, advertising, disconnected } = openLink('ios');
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'iphone-host',
    });
    link.onUnsubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'iphone-host',
    });
    await vi.advanceTimersByTimeAsync(ANDROID_READVERTISE_DELAY_MS);
    expect(disconnected()).toBe(1);
    expect(advertising).toHaveLength(0);
    expect(ble.setServices).not.toHaveBeenCalled();
    expect(ble.closeGattServer).not.toHaveBeenCalled();
  });

  it('cancels a pending Android readvertise when the session stops', async () => {
    const { link, advertising } = openLink('android');
    link.onSubscribed({
      characteristicUUID: nanoX.notifyCharUUID,
      centralId: 'chrome',
    });
    link.stop();
    await vi.advanceTimersByTimeAsync(ANDROID_READVERTISE_DELAY_MS);
    expect(advertising).toHaveLength(0);
    expect(link.stopped).toBe(true);
  });
});
