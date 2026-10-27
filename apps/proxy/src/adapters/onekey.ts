import { OneKeyUsbBleBridge } from '@cws/protocol-onekey';
import type { AdapterHandle, BlePort, ExclusiveLock, HidPort } from '../ports';
import { createExclusive, serializeWrites } from '../ports';
import type { LogFn } from '../log';

export function attachOneKey(
  hid: HidPort,
  ble: BlePort,
  protocol: 'onekey-v1' | 'onekey-v2',
  mtu: number,
  log: LogFn,
  exclusive: ExclusiveLock = createExclusive(),
): AdapterHandle {
  const bridge = new OneKeyUsbBleBridge(protocol, mtu);
  const queue = serializeWrites((error) => log(`onekey write failed: ${String(error)}`));
  let hidCount = 0;
  let bleCount = 0;
  let labAwaiting = false;
  const offHid = hid.onInput((report) => {
    hidCount += 1;
    let packets: Uint8Array[] | null;
    try {
      packets = bridge.pushHid(report);
    } catch (error) {
      log(`onekey HID: ${String(error)}`);
      return;
    }
    if (!packets) {
      return;
    }
    queue.push(() =>
      exclusive.run(async () => {
        if (labAwaiting) {
          log('hid dropped, lab in flight');
          return;
        }
        for (const packet of packets) {
          await ble.write(packet);
        }
      }),
    );
  });
  const offBle = ble.onNotify((packet) => {
    if (labAwaiting) {
      return;
    }
    bleCount += 1;
    let reports: Uint8Array[] | null;
    try {
      reports = bridge.pushBle(packet);
    } catch (error) {
      log(`onekey BLE: ${String(error)}`);
      return;
    }
    if (!reports) {
      return;
    }
    for (const report of reports) {
      hid.write(report);
    }
  });
  return {
    close() {
      queue.abort();
      offHid();
      offBle();
      log(`onekey reports hid=${hidCount} notify=${bleCount}`);
    },
    idle() {
      return queue.idle();
    },
    setLabAwaiting(active) {
      labAwaiting = active;
    },
  };
}
