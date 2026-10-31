import { ledgerGatt, ONEKEY_BLE, TREZOR_BLE } from './bleIdentity';
import type { DeviceModel } from './index';
import {
  ledgerUsbIdentity,
  ONEKEY_USB_VID,
  onekeyUsbProductId,
  TREZOR_HID_PID,
  TREZOR_USB_VID,
  vendorUsbIdentity,
} from './usb';

export { bleAdvertiseName, bleGapLocalName, bleGapNameMatches } from './bleIdentity';

function onekeyUsb(modelId: string) {
  return vendorUsbIdentity(ONEKEY_USB_VID, onekeyUsbProductId(modelId));
}

export const LEDGER_MODELS: DeviceModel[] = [
  {
    id: 'nano-x',
    brand: 'ledger',
    name: 'Ledger Nano X',
    ...ledgerGatt('nano-x'),
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('nano-x'),
  },
  {
    id: 'flex',
    brand: 'ledger',
    name: 'Ledger Flex',
    ...ledgerGatt('flex'),
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('flex'),
  },
  {
    id: 'stax',
    brand: 'ledger',
    name: 'Ledger Stax',
    ...ledgerGatt('stax'),
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('stax'),
  },
  {
    id: 'gen5',
    brand: 'ledger',
    name: 'Ledger Nano Gen5',
    ...ledgerGatt('gen5'),
    protocol: 'ledger-apdu',
    usb: ledgerUsbIdentity('gen5'),
  },
];

export const TREZOR_MODELS: DeviceModel[] = [
  {
    id: 'safe-7',
    brand: 'trezor',
    name: 'Trezor Safe 7',
    ...TREZOR_BLE,
    protocol: 'thp',
    usb: vendorUsbIdentity(TREZOR_USB_VID, TREZOR_HID_PID),
  },
];

export const ONEKEY_MODELS: DeviceModel[] = [
  {
    id: 'classic',
    brand: 'onekey',
    name: 'OneKey Classic',
    ...ONEKEY_BLE,
    protocol: 'onekey-v1',
    usb: onekeyUsb('classic'),
  },
  {
    id: 'classic1s',
    brand: 'onekey',
    name: 'OneKey Classic 1s',
    ...ONEKEY_BLE,
    protocol: 'onekey-v1',
    usb: onekeyUsb('classic1s'),
  },
  {
    id: 'pure',
    brand: 'onekey',
    name: 'OneKey Pure',
    ...ONEKEY_BLE,
    protocol: 'onekey-v1',
    usb: onekeyUsb('pure'),
  },
  {
    id: 'touch',
    brand: 'onekey',
    name: 'OneKey Touch',
    ...ONEKEY_BLE,
    protocol: 'onekey-v1',
    usb: onekeyUsb('touch'),
  },
  {
    id: 'pro',
    brand: 'onekey',
    name: 'OneKey Pro',
    ...ONEKEY_BLE,
    protocol: 'onekey-v1',
    usb: onekeyUsb('pro'),
  },
  {
    id: 'pro2',
    brand: 'onekey',
    name: 'OneKey Pro 2',
    ...ONEKEY_BLE,
    protocol: 'onekey-v2',
    usb: onekeyUsb('pro2'),
  },
  {
    id: 'neo',
    brand: 'onekey',
    name: 'OneKey Neo',
    ...ONEKEY_BLE,
    protocol: 'onekey-v2',
    usb: onekeyUsb('neo'),
  },
];

export const ALL_MODELS = [...LEDGER_MODELS, ...TREZOR_MODELS, ...ONEKEY_MODELS];
