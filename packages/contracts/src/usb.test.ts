import { describe, expect, it } from 'vitest';
import { ALL_MODELS } from './models';
import {
  HID_PACKET_SIZE,
  LEDGER_USB_VID,
  ONEKEY_USB_VID,
  TREZOR_HID_PID,
  TREZOR_USB_VID,
  hidDescriptorFor,
  ledgerGenericHidProductId,
  onekeyUsbProductId,
} from './usb';

describe('USB HID identity', () => {
  it('gives every model a VID/PID and a 64-byte vendor descriptor', () => {
    expect(ALL_MODELS.every((model) => model.usb.vendorId > 0 && model.usb.productId > 0)).toBe(true);
    const descriptor = hidDescriptorFor(ALL_MODELS[0].usb);
    expect(descriptor[0]).toBe(0x06);
    expect(descriptor[descriptor.length - 1]).toBe(0xc0);
    expect(HID_PACKET_SIZE).toBe(64);
  });

  it('uses Ledger VID 0x2c97 and Nano X generic HID 0x4001', () => {
    const nano = ALL_MODELS.find((model) => model.id === 'nano-x')!;
    expect(nano.usb.vendorId).toBe(LEDGER_USB_VID);
    expect(nano.usb.productId).toBe(ledgerGenericHidProductId('nano-x'));
    expect(nano.usb.productId).toBe(0x4001);
  });

  it('uses OneKey / Trezor pid.codes VID 0x1209', () => {
    expect(onekeyUsbProductId('classic')).toBe(0x4f4b);
    expect(onekeyUsbProductId('pro2')).toBe(0x4f4d);
    const classic = ALL_MODELS.find((model) => model.id === 'classic')!;
    expect(classic.usb.vendorId).toBe(ONEKEY_USB_VID);
    const safe7 = ALL_MODELS.find((model) => model.id === 'safe-7')!;
    expect(safe7.usb.vendorId).toBe(TREZOR_USB_VID);
    expect(safe7.usb.productId).toBe(TREZOR_HID_PID);
  });
});
