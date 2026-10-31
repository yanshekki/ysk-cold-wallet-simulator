import net from 'node:net';
import type { BlePort, Unsubscribe } from './ports';

export const BLE_FRAME_MAX = 1_000_000;
const OPEN_MS = 8_000;

export type BleFrame = {
  op:
    | 'scan'
    | 'found'
    | 'scanDone'
    | 'connect'
    | 'write'
    | 'notify'
    | 'close'
    | 'ok'
    | 'error'
    | 'disconnected';
  id?: string;
  name?: string;
  services?: string[];
  writeUuid?: string;
  notifyUuid?: string;
  packet?: string;
  timeoutMs?: number;
  message?: string;
  rssi?: number | null;
};

export type BleScanHit = {
  id: string;
  name: string;
  services: string[];
  rssi?: number | null;
};

type Rpc = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export function encodeBleFrame(frame: BleFrame): Buffer {
  const body = Buffer.from(JSON.stringify(frame), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function takeBleFrames(buffer: Buffer): { frames: BleFrame[]; rest: Buffer } {
  const frames: BleFrame[] = [];
  let rest = buffer;
  while (rest.length >= 4) {
    const size = rest.readUInt32BE(0);
    if (size > BLE_FRAME_MAX) {
      throw new Error(`ble frame too large (${size})`);
    }
    if (rest.length < 4 + size) {
      break;
    }
    const json = rest.subarray(4, 4 + size).toString('utf8');
    rest = rest.subarray(4 + size);
    frames.push(JSON.parse(json) as BleFrame);
  }
  return { frames, rest };
}

export class BleSocketClient {
  onDead: (() => void) | undefined;
  private leftover = Buffer.alloc(0);
  private closed = false;
  private linked = false;
  private writeUuid = '';
  private readonly listeners: Array<(packet: Uint8Array) => void> = [];
  private pending: Rpc | undefined;
  private scanWait:
    | { hits: BleScanHit[]; resolve: (hits: BleScanHit[]) => void; reject: (error: Error) => void }
    | undefined;
  private chain = Promise.resolve();

  private constructor(private readonly socket: net.Socket) {
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('ble socket closed')));
  }

  static connect(socketPath: string): Promise<BleSocketClient> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`ble socket open timed out (${socketPath})`));
      }, OPEN_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(new BleSocketClient(socket));
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  scan(timeoutMs: number): Promise<BleScanHit[]> {
    return this.enqueue(
      () =>
        new Promise<BleScanHit[]>((resolve, reject) => {
          const wait = {
            hits: [] as BleScanHit[],
            resolve: (hits: BleScanHit[]) => {
              clearTimeout(timer);
              resolve(hits);
            },
            reject: (error: Error) => {
              clearTimeout(timer);
              reject(error);
            },
          };
          const timer = setTimeout(() => {
            if (this.scanWait === wait) {
              this.scanWait = undefined;
              wait.reject(new Error('ble scan timed out'));
            }
          }, timeoutMs + 5_000);
          this.scanWait = wait;
          this.send({ op: 'scan', timeoutMs });
        }),
    );
  }

  async connectGatt(id: string, writeUuid: string, notifyUuid: string): Promise<void> {
    this.writeUuid = writeUuid;
    await this.enqueue(() =>
      this.rpc({ op: 'connect', id, writeUuid, notifyUuid }).then(() => {
        this.linked = true;
      }),
    );
  }

  write(packet: Uint8Array): Promise<void> {
    return this.enqueue(() =>
      this.rpc({ op: 'write', packet: Buffer.from(packet).toString('base64') }),
    );
  }

  onNotify(callback: (packet: Uint8Array) => void): Unsubscribe {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  isConnected(): boolean {
    return this.linked && !this.closed;
  }

  isDead(): boolean {
    return this.closed;
  }

  debugInfo(): string {
    return `write=${this.writeUuid} flags=swift-cb`;
  }

  async closeGatt(): Promise<void> {
    this.linked = false;
    if (this.closed) {
      return;
    }
    await this.enqueue(() => this.rpc({ op: 'close' })).catch(() => undefined);
  }

  destroy(): void {
    this.fail(new Error('ble socket destroyed'));
  }

  asPort(): BlePort & { isConnected(): Promise<boolean>; debugInfo(): string } {
    return {
      write: (packet) => this.write(packet),
      onNotify: (callback) => this.onNotify(callback),
      close: () => this.closeGatt(),
      isConnected: async () => this.isConnected(),
      debugInfo: () => this.debugInfo(),
    };
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private rpc(frame: BleFrame): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('ble socket closed'));
        return;
      }
      this.pending = { resolve, reject };
      this.send(frame);
    });
  }

  private send(frame: BleFrame): void {
    if (this.closed) {
      return;
    }
    this.socket.write(encodeBleFrame(frame));
  }

  private onData(chunk: Buffer): void {
    this.leftover = Buffer.concat([this.leftover, chunk]);
    let frames: BleFrame[];
    try {
      const taken = takeBleFrames(this.leftover);
      frames = taken.frames;
      this.leftover = taken.rest;
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    for (const frame of frames) {
      if (frame.op === 'found' && this.scanWait) {
        const hit: BleScanHit = {
          id: frame.id ?? '',
          name: frame.name ?? '',
          services: frame.services ?? [],
        };
        if (typeof frame.rssi === 'number' && Number.isFinite(frame.rssi)) {
          hit.rssi = frame.rssi;
        }
        this.scanWait.hits.push(hit);
      } else if (frame.op === 'scanDone') {
        const wait = this.scanWait;
        this.scanWait = undefined;
        wait?.resolve(wait.hits);
      } else if (frame.op === 'notify' && frame.packet) {
        const packet = Uint8Array.from(Buffer.from(frame.packet, 'base64'));
        for (const listener of this.listeners) {
          try {
            listener(packet);
          } catch {
            // a bad notify must not tear down the socket
          }
        }
      } else if (frame.op === 'disconnected') {
        this.linked = false;
      } else if (frame.op === 'ok') {
        if (frame.writeUuid) {
          this.writeUuid = frame.writeUuid;
        }
        const rpc = this.pending;
        this.pending = undefined;
        rpc?.resolve();
      } else if (frame.op === 'error') {
        const error = new Error(frame.message ?? 'ble socket error');
        const rpc = this.pending;
        this.pending = undefined;
        if (rpc) {
          rpc.reject(error);
        } else if (this.scanWait) {
          const wait = this.scanWait;
          this.scanWait = undefined;
          wait.reject(error);
        }
      }
    }
  }

  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.linked = false;
    const rpc = this.pending;
    this.pending = undefined;
    rpc?.reject(error);
    const scan = this.scanWait;
    this.scanWait = undefined;
    scan?.reject(error);
    this.socket.destroy();
    this.onDead?.();
  }
}

let client: Promise<BleSocketClient> | undefined;
let clientPath = '';
let live: BleSocketClient | undefined;

export function resetBleSocketForTests(): void {
  live?.destroy();
  client = undefined;
  clientPath = '';
  live = undefined;
}

function forget(socket: BleSocketClient): void {
  if (live === socket) {
    live = undefined;
    client = undefined;
  }
}

function clientFor(socketPath: string): Promise<BleSocketClient> {
  if (client && clientPath === socketPath) {
    return client.then((socket) => {
      if (socket.isDead()) {
        client = undefined;
        live = undefined;
        return clientFor(socketPath);
      }
      return socket;
    });
  }
  clientPath = socketPath;
  client = BleSocketClient.connect(socketPath)
    .then((socket) => {
      live = socket;
      socket.onDead = () => forget(socket);
      return socket;
    })
    .catch((error) => {
      client = undefined;
      live = undefined;
      throw error;
    });
  return client;
}

export async function scanBleSocket(socketPath: string, timeoutMs: number): Promise<BleScanHit[]> {
  const socket = await clientFor(socketPath);
  return socket.scan(timeoutMs);
}

export async function openBleSocket(
  socketPath: string,
  id: string,
  writeUuid: string,
  notifyUuid: string,
): Promise<BlePort & { isConnected(): Promise<boolean>; debugInfo(): string }> {
  const socket = await clientFor(socketPath);
  await socket.connectGatt(id, writeUuid, notifyUuid);
  return socket.asPort();
}
