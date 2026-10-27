import {
  BleReassembler,
  bytesToHex,
  describeAppAndVersion,
  ensureAppAndVersion,
  normalizeHidReport,
  openAppName,
  parseApdu,
  parseAppAndVersion,
  TAG_APDU,
  TAG_PROTOCOL_VERSION,
  unwrapHidReports,
  UsbBleProxy,
  wrapHidFrame,
} from '@cws/protocol-ledger';
import type { AdapterHandle, BlePort, ExclusiveLock, HidPort } from '../ports';
import { createExclusive, serializeWrites } from '../ports';
import type { LogFn } from '../log';

function preview(bytes: Uint8Array): string {
  const take = Math.min(bytes.length, 12);
  let hex = '';
  for (let i = 0; i < take; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `${bytes.length}b ${hex}`;
}

function bleApduHead(packets: Uint8Array[]): { cla: number; ins: number } | undefined {
  const first = packets[0];
  if (!first || first.length < 7 || first[0] !== TAG_APDU) {
    return undefined;
  }
  return { cla: first[5], ins: first[6] };
}

function isGetApp(head?: { cla: number; ins: number }): boolean {
  return head?.cla === 0xb0 && head?.ins === 0x01;
}

const BLE_WAIT_MS = 180_000;
const STATUS_HOLD_MS = 80;

function hidChannel(report: Uint8Array): number {
  const bytes = normalizeHidReport(report);
  return (bytes[0] << 8) | bytes[1];
}

function isBlankHid(report: Uint8Array): boolean {
  if (report.length === 0) {
    return true;
  }
  for (let i = 0; i < report.length; i += 1) {
    if (report[i] !== 0) {
      return false;
    }
  }
  return true;
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

function bleFrameFromPackets(packets: Uint8Array[]): { tag: number; payload: Uint8Array } | null {
  const assembler = new BleReassembler();
  let frame = null;
  for (const packet of packets) {
    frame = assembler.push(packet);
  }
  return frame;
}

function apduPreview(payload: Uint8Array): string {
  try {
    const apdu = parseApdu(payload);
    return `cla=${apdu.cla.toString(16).padStart(2, '0')} ins=${apdu.ins.toString(16).padStart(2, '0')}`;
  } catch {
    return preview(payload);
  }
}

export function attachLedger(
  hid: HidPort,
  ble: BlePort,
  mtu: number,
  log: LogFn,
  _modelId = 'nano-x',
  exclusive: ExclusiveLock = createExclusive(),
): AdapterHandle {
  const proxy = new UsbBleProxy(mtu);
  const queue = serializeWrites((error) => log(`ledger write failed: ${String(error)}`));
  let hidCount = 0;
  let bleCount = 0;
  let labAwaiting = false;
  let awaiting = false;
  let receiveArmed = false;
  let hidBusy = 0;
  let deferredGetApp = false;
  let deferredGetAppChannel: number | undefined;
  let lastStatusSw: number | undefined;
  let lastAppName = 'BOLOS';
  let pendingOpenName: string | undefined;
  let outstanding: { cla: number; ins: number } | undefined;
  let inflightChannel: number | undefined;
  let busyChannel: number | undefined;
  let heldStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let heldStatusReports: Uint8Array[] | undefined;
  let heldStatusSw: number | undefined;
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

  const writeHid = (reports: Uint8Array[], note: string) => {
    for (const report of reports) {
      log(`hid => ${note} ${preview(report)}`);
      hid.write(report);
    }
  };

  const replyGetApp = (channel?: number) => {
    deferredGetApp = false;
    deferredGetAppChannel = undefined;
    const payload = ensureAppAndVersion(new Uint8Array(), lastAppName);
    const parsed = parseAppAndVersion(payload);
    writeHid(
      proxy.replyHid(TAG_APDU, payload, channel),
      `local GET_APP_AND_VERSION ${parsed?.name ?? lastAppName}`,
    );
  };

  const flushDeferredGetApp = () => {
    if (deferredGetApp && hidBusy === 0 && !awaiting) {
      replyGetApp(deferredGetAppChannel);
    }
  };

  const clearHeldStatus = () => {
    if (heldStatusTimer !== undefined) {
      clearTimeout(heldStatusTimer);
      heldStatusTimer = undefined;
    }
    heldStatusReports = undefined;
    heldStatusSw = undefined;
  };

  const settleReply = (reports: Uint8Array[], sw: number | undefined) => {
    if (outstanding?.cla === 0xe0 && outstanding.ins === 0xd8) {
      if (sw === 0x9000 && pendingOpenName) {
        lastAppName = pendingOpenName;
      }
      pendingOpenName = undefined;
    }
    const appNote =
      outstanding?.cla === 0xb0 && outstanding.ins === 0x01
        ? describeAppAndVersion(unwrapHidReports(reports).payload)
        : undefined;
    awaiting = false;
    outstanding = undefined;
    lastStatusSw = sw;
    writeHid(reports, appNote ?? 'ble');
    settlePending();
  };

  const holdUnsupported = (sw: number, reports: Uint8Array[]) => {
    heldStatusReports = reports;
    heldStatusSw = sw;
    if (heldStatusTimer !== undefined) {
      return;
    }
    heldStatusTimer = setTimeout(() => {
      heldStatusTimer = undefined;
      const held = heldStatusReports;
      const heldSw = heldStatusSw;
      heldStatusReports = undefined;
      heldStatusSw = undefined;
      if (!awaiting || !held) {
        return;
      }
      log(
        `hid => forwarded 0x${(heldSw ?? 0).toString(16)} for cla=${(outstanding?.cla ?? 0).toString(16).padStart(2, '0')} ins=${(outstanding?.ins ?? 0).toString(16).padStart(2, '0')}`,
      );
      settleReply(held, heldSw);
    }, STATUS_HOLD_MS);
  };

  const offHid = hid.onInput((report) => {
    hidCount += 1;
    if (isBlankHid(report)) {
      log(`hid <= ignored blank ${preview(report)}`);
      return;
    }
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
    const frame = bleFrameFromPackets(packets);
    if (frame?.tag === TAG_PROTOCOL_VERSION) {
      writeHid(proxy.replyHid(frame.tag, frame.payload), 'ping');
      return;
    }
    if (frame?.tag === TAG_APDU) {
      log(`hid <= apdu ${apduPreview(frame.payload)}`);
    }
    const head = bleApduHead(packets);
    const channel = hidChannel(report);
    if (isGetApp(head)) {
      const sameChannel =
        (inflightChannel !== undefined && channel === inflightChannel) ||
        (busyChannel !== undefined && channel === busyChannel);
      if ((awaiting || hidBusy > 0) && sameChannel) {
        deferredGetApp = true;
        deferredGetAppChannel = channel;
        log('hid <= deferred GET_APP_AND_VERSION (apdu in flight)');
        return;
      }
      replyGetApp(channel);
      return;
    }
    if (head?.cla === 0xe0 && head.ins === 0xd8 && frame?.payload) {
      try {
        const name = openAppName(parseApdu(frame.payload).data).trim();
        pendingOpenName = name.length > 0 ? name : undefined;
      } catch {
        pendingOpenName = undefined;
      }
    }
    if (head?.cla === 0xb0 && head.ins === 0xa7) {
      lastAppName = 'BOLOS';
      pendingOpenName = undefined;
    }
    hidBusy += 1;
    busyChannel = channel;
    queue.push(() =>
      exclusive.run(async () => {
        try {
          if (labAwaiting) {
            log('hid dropped, lab in flight');
            return;
          }
          outstanding = head;
          inflightChannel = channel;
          awaiting = true;
          receiveArmed = false;
          proxy.resetBle();
          const done = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              settlePending(new Error('ble response timed out'));
            }, BLE_WAIT_MS);
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
          receiveArmed = true;
          await done;
        } finally {
          receiveArmed = false;
          inflightChannel = undefined;
          hidBusy = Math.max(0, hidBusy - 1);
          if (hidBusy === 0) {
            busyChannel = undefined;
          }
          flushDeferredGetApp();
        }
      }),
    );
  });
  const offBle = ble.onNotify((packet) => {
    if (labAwaiting) {
      return;
    }
    bleCount += 1;
    log(`ble <= ${preview(packet)}`);
    let reports: Uint8Array[] | null;
    try {
      reports = proxy.pushBle(packet, inflightChannel);
      if (reports) {
        const frame = unwrapHidReports(reports);
        const parsed = parseAppAndVersion(frame.payload);
        if (parsed?.name && parsed.version && !isGetApp(outstanding)) {
          log(`hid => dropped extra GET_APP_AND_VERSION ${parsed.name}`);
          return;
        }
        if (isGetApp(outstanding)) {
          const fixed = ensureAppAndVersion(frame.payload, lastAppName);
          if (parsed?.name) {
            lastAppName = parsed.name;
          }
          if (fixed !== frame.payload) {
            log(
              `hid => patched GET_APP_AND_VERSION ${bytesToHex(frame.payload)}->${parsed?.name ?? '?'} ${parsed?.version ?? ''}`,
            );
            reports = wrapHidFrame(frame.tag, fixed, frame.channel);
          }
        }
      }
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
    if (!receiveArmed && sw === 0x9000 && sw === lastStatusSw) {
      log(`hid => ignored leftover 0x${sw.toString(16)} from previous APDU`);
      return;
    }
    if (sw === 0x6d00 || sw === 0x6e00) {
      // Same-SW retries (Stellar e0 06 after a 6d00) arrive before receiveArmed.
      // Dropping them as leftover stalls the HID queue; hold-forward instead.
      log(
        `hid => holding 0x${sw.toString(16)} while waiting for cla=${(outstanding?.cla ?? 0).toString(16).padStart(2, '0')} ins=${(outstanding?.ins ?? 0).toString(16).padStart(2, '0')}`,
      );
      holdUnsupported(sw, reports);
      return;
    }
    clearHeldStatus();
    settleReply(reports, sw);
  });
  return {
    close() {
      clearHeldStatus();
      queue.abort();
      settlePending(new Error('closed'));
      offHid();
      offBle();
      log(`ledger reports hid=${hidCount} notify=${bleCount}`);
    },
    idle() {
      return queue.idle();
    },
    setLabAwaiting(active) {
      labAwaiting = active;
    },
  };
}
