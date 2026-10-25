import { UsbBleProxy, normalizeHidReport } from '@cws/protocol-ledger';
import type { AdapterHandle, BlePort, HidPort } from '../ports';
import { serializeWrites } from '../ports';
import type { LogFn } from '../log';

function preview(bytes: Uint8Array): string {
  const take = Math.min(bytes.length, 8);
  let hex = '';
  for (let i = 0; i < take; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `${bytes.length}b ${hex}`;
}

function bleApduIns(packets: Uint8Array[]): number | undefined {
  const first = packets[0];
  if (!first || first.length < 7 || first[0] !== 0x05) {
    return undefined;
  }
  return first[6];
}

function hidStatusWord(report: Uint8Array): number | undefined {
  if (report.length < 9) {
    return undefined;
  }
  const length = (report[5] << 8) | report[6];
  if (length !== 2) {
    return undefined;
  }
  return (report[7] << 8) | report[8];
}

export function attachLedger(hid: HidPort, ble: BlePort, mtu: number, log: LogFn): AdapterHandle {
  const proxy = new UsbBleProxy(mtu);
  const queue = serializeWrites((error) => log(`ledger write failed: ${String(error)}`));
  let hidCount = 0;
  let bleCount = 0;
  let awaiting = false;
  let outstandingIns: number | undefined;
  let pending: { resolve: () => void; reject: (error: Error) => void } | undefined;

  const settlePending = (error?: Error) => {
    const wait = pending;
    pending = undefined;
    if (!wait) {
      return;
    }
    if (error) {
      wait.reject(error);
    } else {
      wait.resolve();
    }
  };

  const offHid = hid.onInput((report) => {
    hidCount += 1;
    log(`hid <= ${preview(report)}`);
    let packets: Uint8Array[] | null;
    try {
      packets = proxy.pushHid(normalizeHidReport(report));
    } catch (error) {
      log(`ledger HID: ${String(error)}`);
      return;
    }
    if (!packets) {
      return;
    }
    awaiting = true;
    outstandingIns = bleApduIns(packets);
    queue.push(async () => {
      proxy.resetBle();
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = undefined;
          reject(new Error('ble response timed out'));
        }, 180_000);
        pending = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
      });
      for (const packet of packets) {
        log(`ble => ${preview(packet)}`);
        await ble.write(packet);
        log(`ble => sent ${preview(packet)}`);
      }
      await done;
    });
  });
  const offBle = ble.onNotify((packet) => {
    bleCount += 1;
    log(`ble <= ${preview(packet)}`);
    let reports: Uint8Array[] | null;
    try {
      reports = proxy.pushBle(packet);
    } catch (error) {
      log(`ledger BLE: ${String(error)}`);
      return;
    }
    if (!reports) {
      return;
    }
    if (!awaiting) {
      log(`hid => dropped extra ${preview(reports[0] ?? packet)}`);
      return;
    }
    const sw = hidStatusWord(reports[0] ?? new Uint8Array());
    if (outstandingIns === 0x02 && (sw === 0x6d00 || sw === 0x6e00)) {
      log(`hid => ignored 0x${sw.toString(16)} while waiting for GET_ADDRESS`);
      return;
    }
    awaiting = false;
    outstandingIns = undefined;
    for (const report of reports) {
      log(`hid => ${preview(report)}`);
      hid.write(report);
    }
    settlePending();
  });
  return {
    close() {
      queue.abort();
      settlePending(new Error('closed'));
      offHid();
      offBle();
      log(`ledger reports hid=${hidCount} notify=${bleCount}`);
    },
    idle() {
      return queue.idle();
    },
  };
}
