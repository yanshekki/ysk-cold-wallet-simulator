import type { DeviceModel } from './index';

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
  },
  {
    id: 'touch',
    brand: 'onekey',
    name: 'OneKey Touch',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v1',
  },
  {
    id: 'pro',
    brand: 'onekey',
    name: 'OneKey Pro',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v1',
  },
  {
    id: 'pro2',
    brand: 'onekey',
    name: 'OneKey Pro 2',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v2',
  },
  {
    id: 'neo',
    brand: 'onekey',
    name: 'OneKey Neo',
    serviceUUID: '00000001-0000-1000-8000-00805f9b34fb',
    writeCharUUID: '00000002-0000-1000-8000-00805f9b34fb',
    notifyCharUUID: '00000003-0000-1000-8000-00805f9b34fb',
    protocol: 'onekey-v2',
  },
];

export const ALL_MODELS = [...LEDGER_MODELS, ...TREZOR_MODELS, ...ONEKEY_MODELS];
