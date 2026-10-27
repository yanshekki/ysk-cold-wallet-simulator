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

function openFrame(model: DeviceModel): HidFrame {
  return {
    op: 'open',
    vid: model.usb.vendorId,
    pid: model.usb.productId,
    name: model.name,
    descriptor: Buffer.from(hidDescriptorFor(model.usb)).toString('base64'),
  };
}

export function isTransientHidOpenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  return /EPIPE|ECONNRESET|ECONNREFUSED|closed before open/i.test(`${code} ${message}`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function openHidSocket(
  socketPath: string,
  model: DeviceModel,
  signal?: AbortSignal,
): Promise<HidPort> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await connectHidSocket(socketPath, model, signal);
    } catch (error) {
      last = error;
      if (signal?.aborted || !isTransientHidOpenError(error) || attempt === 3) {
        throw error;
      }
      await sleep(80 * (attempt + 1), signal);
    }
  }
  throw last;
}

function connectHidSocket(
  socketPath: string,
  model: DeviceModel,
  signal?: AbortSignal,
): Promise<HidPort> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const listeners: Array<(report: Uint8Array) => void> = [];
    const pending: Uint8Array[] = [];
    let leftover = Buffer.alloc(0);
    let opened = false;
    let closed = false;
    let switchWait:
      | { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
      | undefined;

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

    function send(frame: HidFrame): boolean {
      if (closed) {
        return false;
      }
      try {
        socket.write(encodeHidFrame(frame));
        return true;
      } catch (error) {
        socket.destroy();
        const wrapped = error instanceof Error ? error : new Error(String(error));
        finishOpen(wrapped);
        finishSwitch(wrapped);
        return false;
      }
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

    function finishSwitch(error?: Error): void {
      const wait = switchWait;
      switchWait = undefined;
      if (!wait) {
        return;
      }
      clearTimeout(wait.timer);
      if (error) {
        wait.reject(error);
        return;
      }
      wait.resolve();
    }

    socket.on('connect', () => {
      send(openFrame(model));
    });

    socket.on('data', (chunk) => {
      leftover = Buffer.concat([leftover, chunk]);
      let frames: HidFrame[];
      try {
        const taken = takeHidFrames(leftover);
        frames = taken.frames;
        leftover = taken.rest;
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        finishOpen(wrapped);
        finishSwitch(wrapped);
        return;
      }
      for (const frame of frames) {
        if (frame.op === 'ok') {
          if (!opened) {
            finishOpen();
          } else {
            finishSwitch();
          }
        } else if (frame.op === 'error') {
          const wrapped = new Error(frame.message ?? 'hid socket error');
          if (!opened) {
            finishOpen(wrapped);
          } else {
            finishSwitch(wrapped);
          }
        } else if (frame.op === 'input' && frame.report) {
          const report = Uint8Array.from(Buffer.from(frame.report, 'base64'));
          if (listeners.length === 0) {
            if (pending.length < 8) {
              pending.push(report);
            }
            continue;
          }
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
      finishSwitch(error);
    });

    socket.on('close', () => {
      closed = true;
      if (!opened) {
        finishOpen(new Error('hid socket closed before open'));
      }
      finishSwitch(new Error('hid socket closed'));
    });

    const port: HidPort = {
      write(report) {
        send({ op: 'write', report: padReport(report).toString('base64') });
      },
      onInput(callback) {
        listeners.push(callback);
        const queued = pending.splice(0);
        for (const report of queued) {
          try {
            callback(report);
          } catch {
            // a bad HID frame must not tear down the socket
          }
        }
        const unsubscribe: Unsubscribe = () => {
          const index = listeners.indexOf(callback);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
        return unsubscribe;
      },
      async switchModel(next) {
        if (closed) {
          throw new Error('hid socket closed');
        }
        if (switchWait) {
          throw new Error('hid switch already in flight');
        }
        await new Promise<void>((resolveSwitch, rejectSwitch) => {
          switchWait = {
            resolve: resolveSwitch,
            reject: rejectSwitch,
            timer: setTimeout(() => {
              finishSwitch(new Error(`hid switch timed out (${socketPath})`));
            }, OPEN_MS),
          };
          if (!send(openFrame(next))) {
            finishSwitch(new Error('hid socket closed'));
          }
        });
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
