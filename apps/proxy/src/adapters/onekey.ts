import { OneKeyUsbBleBridge } from '@cws/protocol-onekey';
import type { AdapterHandle, BlePort, HidPort } from '../ports';
import { serializeWrites } from '../ports';
import type { LogFn } from '../log';

export function attachOneKey(
  hid: HidPort,
  ble: BlePort,
  protocol: 'onekey-v1' | 'onekey-v2',
  mtu: number,
  log: LogFn,
): AdapterHandle {
  const bridge = new OneKeyUsbBleBridge(protocol, mtu);
  const queue = serializeWrites((error) => log(`onekey write failed: ${String(error)}`));
  let hidCount = 0;
  let bleCount = 0;
  const offHid = hid.onInput((report) => {
    hidCount += 1;
    const packets = bridge.pushHid(report);
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
    const reports = bridge.pushBle(packet);
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
      log(`onekey reports hid=${hidCount} notify=${bleCount}`);
    },
    idle() {
      return queue.idle();
    },
  };
}
