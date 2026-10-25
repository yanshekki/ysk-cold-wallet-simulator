import { UsbHidReassembler, wrapUsbHid, type UsbProtobuf } from '@cws/protocol-trezor';
import type { AdapterHandle, HidPort } from '../ports';
import { serializeWrites } from '../ports';
import type { LogFn } from '../log';
import type { ThpClient, TrezorMessage } from './thp';

export async function forwardUsb(thp: ThpClient, message: UsbProtobuf): Promise<TrezorMessage> {
  return thp.app(message.type, message.payload);
}

export function attachTrezor(hid: HidPort, thp: ThpClient, log: LogFn): AdapterHandle {
  const usb = new UsbHidReassembler();
  const queue = serializeWrites((error) => log(`trezor write failed: ${String(error)}`));
  let hidCount = 0;
  const offHid = hid.onInput((report) => {
    hidCount += 1;
    let message: UsbProtobuf | null;
    try {
      message = usb.push(report);
    } catch (error) {
      log(`trezor HID: ${String(error)}`);
      usb.reset();
      return;
    }
    if (!message) {
      return;
    }
    const request = message;
    queue.push(async () => {
      const reply = await forwardUsb(thp, request);
      for (const out of wrapUsbHid(reply.type, reply.payload)) {
        hid.write(out);
      }
    });
  });
  return {
    close() {
      offHid();
      log(`trezor reports hid=${hidCount}`);
    },
    idle() {
      return queue.idle();
    },
  };
}
