export const USB_HID_REPORT_SIZE = 64;
export const HID_PACKET_SIZE = USB_HID_REPORT_SIZE;

export type UsbHidIdentity = {
  vendorId: number;
  productId: number;
  usagePage: number;
  usage: number;
};

export const LEDGER_USB_VID = 0x2c97;
export const LEDGER_HID_USAGE_PAGE = 0xffa0;
export const LEDGER_HID_USAGE = 0x01;

export const ONEKEY_USB_VID = 0x1209;
export const TREZOR_USB_VID = 0x1209;
export const TREZOR_HID_PID = 0x53c0;
export const VENDOR_HID_USAGE_PAGE = 0xff00;
export const VENDOR_HID_USAGE = 0x01;

/** USB product ID is MMII: model byte + Generic HID (0x01). */
export const LEDGER_USB_MODEL: Record<string, { mm: number; legacyPid: number }> = {
  'nano-x': { mm: 0x40, legacyPid: 0x0004 },
  flex: { mm: 0x70, legacyPid: 0x0007 },
  stax: { mm: 0x60, legacyPid: 0x0006 },
  gen5: { mm: 0x80, legacyPid: 0x0008 },
};

export function ledgerGenericHidProductId(modelId: string): number {
  const spec = LEDGER_USB_MODEL[modelId] ?? LEDGER_USB_MODEL['nano-x'];
  return (spec.mm << 8) | 0x01;
}

export function ledgerUsbIdentity(modelId: string): UsbHidIdentity {
  return {
    vendorId: LEDGER_USB_VID,
    productId: ledgerGenericHidProductId(modelId),
    usagePage: LEDGER_HID_USAGE_PAGE,
    usage: LEDGER_HID_USAGE,
  };
}

export function vendorUsbIdentity(vendorId: number, productId: number): UsbHidIdentity {
  return {
    vendorId,
    productId,
    usagePage: VENDOR_HID_USAGE_PAGE,
    usage: VENDOR_HID_USAGE,
  };
}

export function onekeyUsbProductId(modelId: string): number {
  if (modelId === 'touch') {
    return 0x4f4c;
  }
  if (modelId === 'pro' || modelId === 'pro2' || modelId === 'neo') {
    return 0x4f4d;
  }
  return 0x4f4b;
}

/** Vendor page, 64-byte Output then 64-byte Input. Matches Ledger / Trezor / OneKey HID. */
export function vendorHidDescriptor(usagePage: number, usage: number): Uint8Array {
  return Uint8Array.of(
    0x06,
    usagePage & 0xff,
    (usagePage >> 8) & 0xff,
    0x09,
    usage & 0xff,
    0xa1,
    0x01,
    0x09,
    0x03,
    0x15,
    0x00,
    0x26,
    0xff,
    0x00,
    0x75,
    0x08,
    0x95,
    0x40,
    0x91,
    0x02,
    0x09,
    0x02,
    0x95,
    0x40,
    0x81,
    0x02,
    0xc0,
  );
}

export function hidDescriptorFor(usb: UsbHidIdentity): Uint8Array {
  return vendorHidDescriptor(usb.usagePage, usb.usage);
}
