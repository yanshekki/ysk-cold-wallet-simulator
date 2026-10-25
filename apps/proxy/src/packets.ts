export class PacketQueue {
  private readonly waiters: Array<(packet: Uint8Array) => void> = [];
  private readonly queued: Uint8Array[] = [];

  push(packet: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(packet);
    } else {
      this.queued.push(packet);
    }
  }

  reset(): void {
    this.waiters.length = 0;
    this.queued.length = 0;
  }

  next(timeout: number): Promise<Uint8Array> {
    const queued = this.queued.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onPacket);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error('BLE timeout waiting for notify'));
      }, Math.max(1, timeout));
      const onPacket = (packet: Uint8Array) => {
        clearTimeout(timer);
        resolve(packet);
      };
      this.waiters.push(onPacket);
    });
  }
}
