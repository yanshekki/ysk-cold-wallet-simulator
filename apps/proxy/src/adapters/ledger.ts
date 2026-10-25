import { UsbBleProxy, normalizeHidReport } from '@cws/protocol-ledger';
import type { AdapterHandle, BlePort, HidPort } from '../ports';
import { serializeWrites } from '../ports';
import type { LogFn } from '../log';

export function attachLedger(hid: HidPort, ble: BlePort, mtu: number, log: LogFn): AdapterHandle {
  const proxy = new UsbBleProxy(mtu);
  const queue = serializeWrites((error) => log(`ledger write failed: ${String(error)}`));
  let hidCount = 0;
  let bleCount = 0;
  const offHid = hid.onInput((report) => {
    hidCount += 1;
    const packets = proxy.pushHid(normalizeHidReport(report));
    if (!packets) {
      return;
    }
    queue.push(async () => {
      for (const packet of packets) {
        await ble.write(packet);
      }
    });
  });
  const offBle = ble.onNotify((packet) => {
    bleCount += 1;
    const reports = proxy.pushBle(packet);
    if (!reports) {
      return;
    }
    for (const report of reports) {
      hid.write(report);
    }
  });
  return {
    close() {
      offHid();
      offBle();
      log(`ledger reports hid=${hidCount} notify=${bleCount}`);
    },
    idle() {
      return queue.idle();
    },
  };
}
