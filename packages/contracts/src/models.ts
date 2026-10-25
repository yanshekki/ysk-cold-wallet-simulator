import type { DeviceModel } from './index';
import {
  ledgerUsbIdentity,
  ONEKEY_USB_VID,
  onekeyUsbProductId,
  TREZOR_HID_PID,
  TREZOR_USB_VID,
  vendorUsbIdentity,
} from './usb';

function onekeyUsb(modelId: string) {
  return vendorUsbIdentity(ONEKEY_USB_VID, onekeyUsbProductId(modelId));
}

export const LEDGER_MODELS: DeviceModel[] = [
  {
    id: 'nano-x',
    brand: 'ledger',
    name: 'Ledger Nano X',
    serviceUUID: '13d63400-2c97-0004-0000-4c6564676572',
    writeCharUUID: '13d63400-2c97-0004-0002-4c6564676572',
    notifyCharUUID: '13d63400-2c97-0004-0001-4c6564676572',
    writeCmdCharUUID: '13d63400-2c97-0004-0003-4c6564676572',
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('nano-x'),
  },
  {
    id: 'flex',
    brand: 'ledger',
    name: 'Ledger Flex',
    serviceUUID: '13d63400-2c97-3004-0000-4c6564676572',
    writeCharUUID: '13d63400-2c97-3004-0002-4c6564676572',
    notifyCharUUID: '13d63400-2c97-3004-0001-4c6564676572',
    writeCmdCharUUID: '13d63400-2c97-3004-0003-4c6564676572',
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('flex'),
  },
  {
    id: 'stax',
    brand: 'ledger',
    name: 'Ledger Stax',
    serviceUUID: '13d63400-2c97-6004-0000-4c6564676572',
    writeCharUUID: '13d63400-2c97-6004-0002-4c6564676572',
    notifyCharUUID: '13d63400-2c97-6004-0001-4c6564676572',
    writeCmdCharUUID: '13d63400-2c97-6004-0003-4c6564676572',
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('stax'),
  },
  {
    id: 'gen5',
    brand: 'ledger',
    name: 'Ledger Nano Gen5',
    serviceUUID: '13d63400-2c97-8004-0000-4c6564676572',
    writeCharUUID: '13d63400-2c97-8004-0002-4c6564676572',
    notifyCharUUID: '13d63400-2c97-8004-0001-4c6564676572',
    writeCmdCharUUID: '13d63400-2c97-8004-0003-4c6564676572',
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('gen5'),
  },
];

export const TREZOR_MODELS: DeviceModel[] = [
  {
    id: 'safe-7',
    brand: 'trezor',
    name: 'Trezor Safe 7',
    serviceUUID: '8c000001-a59b-4d58-a9ad-073df69fa1b1',
    writeCharUUID: '8c000002-a59b-4d58-a9ad-073df69fa1b1',
    notifyCharUUID: '8c000003-a59b-4d58-a9ad-073df69fa1b1',
    protocol: 'thp',
    usb: vendorUsbIdentity(TREZOR_USB_VID, TREZOR_HID_PID),
  },
];

export const ONEKEY_MODELS: DeviceModel[] = [
  {
    id: 'classic',
    brand: 'onekey',
    name: 'OneKey Classic',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v1',
    usb: onekeyUsb('classic'),
  },
  {
    id: 'classic1s',
    brand: 'onekey',
    name: 'OneKey Classic 1s',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v1',
    usb: onekeyUsb('classic1s'),
  },
  {
    id: 'pure',
    brand: 'onekey',
    name: 'OneKey Pure',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v1',
    usb: onekeyUsb('pure'),
  },
  {
    id: 'touch',
    brand: 'onekey',
    name: 'OneKey Touch',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v1',
    usb: onekeyUsb('touch'),
  },
  {
    id: 'pro',
    brand: 'onekey',
    name: 'OneKey Pro',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v1',
    usb: onekeyUsb('pro'),
  },
  {
    id: 'pro2',
    brand: 'onekey',
    name: 'OneKey Pro 2',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v2',
    usb: onekeyUsb('pro2'),
  },
  {
    id: 'neo',
    brand: 'onekey',
    name: 'OneKey Neo',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v2',
    usb: onekeyUsb('neo'),
  },
];

export const ALL_MODELS = [...LEDGER_MODELS, ...TREZOR_MODELS, ...ONEKEY_MODELS];

/**
 * BLE GAP local name. OneKey desktop ignores peripherals with an empty
 * advertisement name, and iOS only fits a short name next to a 128-bit UUID.
 * Classic/Touch use the 5-character serial form; Pro uses `Pro XXXX`.
 */
const ONEKEY_BLE_NAMES: Record<string, string> = {
  classic: 'K1234',
  classic1s: '1S A1B2',
  pure: 'P1234',
  touch: 'T1234',
  pro: 'Pro A1B2',
  pro2: 'Pro 2 A1B2',
  neo: 'Neo A1B2',
};

/** iOS ADV packets only fit ~8 chars next to a 128-bit service UUID. */
const LEDGER_BLE_NAMES: Record<string, string> = {
  'nano-x': 'Nano X',
  flex: 'Flex',
  stax: 'Stax',
  gen5: 'Nano G5',
};

export function bleAdvertiseName(model: DeviceModel): string {
  if (model.brand === 'onekey') {
    return ONEKEY_BLE_NAMES[model.id] ?? model.name;
  }
  if (model.brand === 'ledger') {
    return LEDGER_BLE_NAMES[model.id] ?? model.name;
  }
  return model.name;
}
