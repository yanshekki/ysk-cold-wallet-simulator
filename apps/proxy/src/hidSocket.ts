import net from 'node:net';
import { hidDescriptorFor, USB_HID_REPORT_SIZE, type DeviceModel } from '@cws/contracts';
import type { HidPort, Unsubscribe } from './ports';

export const HID_FRAME_MAX = 1_000_000;
const OPEN_MS = 8_000;

export type HidFrame = {
  op: 'open' | 'write' | 'close' | 'ok' | 'input' | 'error';
  vid?: number;
  pid?: number;
  name?: string;
  descriptor?: string;
  report?: string;
  message?: string;
};

export function encodeHidFrame(frame: HidFrame): Buffer {
  const body = Buffer.from(JSON.stringify(frame), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function takeHidFrames(buffer: Buffer): { frames: HidFrame[]; rest: Buffer } {
  const frames: HidFrame[] = [];
  let rest = buffer;
  while (rest.length >= 4) {
    const size = rest.readUInt32BE(0);
    if (size > HID_FRAME_MAX) {
      throw new Error(`hid frame too large (${size})`);
    }
    if (rest.length < 4 + size) {
      break;
    }
    const json = rest.subarray(4, 4 + size).toString('utf8');
    rest = rest.subarray(4 + size);
    frames.push(JSON.parse(json) as HidFrame);
  }
  return { frames, rest };
}

function padReport(report: Uint8Array): Buffer {
  if (report.length === USB_HID_REPORT_SIZE) {
    return Buffer.from(report);
  }
  const padded = Buffer.alloc(USB_HID_REPORT_SIZE);
  padded.set(report.subarray(0, Math.min(report.length, USB_HID_REPORT_SIZE)));
  return padded;
}

export function openHidSocket(
  socketPath: string,
  model: DeviceModel,
  signal?: AbortSignal,
): Promise<HidPort> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const listeners: Array<(report: Uint8Array) => void> = [];
    let leftover = Buffer.alloc(0);
    let opened = false;
    let closed = false;

    const timer = setTimeout(() => {
      if (!opened) {
        socket.destroy();
        reject(new Error(`hid socket open timed out (${socketPath})`));
      }
    }, OPEN_MS);

    const onAbort = () => {
      socket.destroy();
      finishOpen(new Error('aborted'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    function send(frame: HidFrame): void {
      if (closed) {
        return;
      }
      socket.write(encodeHidFrame(frame));
    }

    function finishOpen(error?: Error): void {
      if (opened) {
        return;
      }
      opened = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        closed = true;
        socket.destroy();
        reject(error);
        return;
      }
      resolve(port);
    }

    socket.on('connect', () => {
      send({
        op: 'open',
        vid: model.usb.vendorId,
        pid: model.usb.productId,
        name: model.name,
        descriptor: Buffer.from(hidDescriptorFor(model.usb)).toString('base64'),
      });
    });

    socket.on('data', (chunk) => {
      leftover = Buffer.concat([leftover, chunk]);
      let frames: HidFrame[];
      try {
        const taken = takeHidFrames(leftover);
        frames = taken.frames;
        leftover = taken.rest;
      } catch (error) {
        finishOpen(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      for (const frame of frames) {
        if (frame.op === 'ok') {
          finishOpen();
        } else if (frame.op === 'error') {
          finishOpen(new Error(frame.message ?? 'hid socket error'));
        } else if (frame.op === 'input' && frame.report) {
          const report = Uint8Array.from(Buffer.from(frame.report, 'base64'));
          for (const listener of listeners) {
            try {
              listener(report);
            } catch {
              // a bad HID frame must not tear down the socket
            }
          }
        }
      }
    });

    socket.on('error', (error) => {
      finishOpen(error);
    });

    socket.on('close', () => {
      if (!opened) {
        finishOpen(new Error('hid socket closed before open'));
      }
      closed = true;
    });

    const port: HidPort = {
      write(report) {
        send({ op: 'write', report: padReport(report).toString('base64') });
      },
      onInput(callback) {
        listeners.push(callback);
        const unsubscribe: Unsubscribe = () => {
          const index = listeners.indexOf(callback);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
        return unsubscribe;
      },
      close() {
        if (closed) {
          return;
        }
        send({ op: 'close' });
        closed = true;
        socket.end();
      },
    };
  });
}
