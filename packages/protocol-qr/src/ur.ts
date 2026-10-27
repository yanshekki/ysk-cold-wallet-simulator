import { Buffer } from 'buffer';
import { UR, URDecoder, UREncoder } from '@ngraveio/bc-ur';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined' || typeof g.Buffer.from !== 'function' || typeof g.Buffer.alloc !== 'function') {
  try {
    g.Buffer = Buffer;
  } catch {
    try {
      Object.defineProperty(globalThis, 'Buffer', {
        configurable: true,
        writable: true,
        value: Buffer,
      });
    } catch {
      // RN may freeze Buffer after the polyfill in apps/mobile.
    }
  }
}

export type UrProgress = {
  complete: boolean;
  success?: boolean;
  type?: string;
  cbor?: Uint8Array;
  received: number;
  expected: number;
  error?: string;
};

export function encodeFountainParts(type: string, cbor: Uint8Array, maxFragment = 200): string[] {
  const encoder = new UREncoder(new UR(Buffer.from(cbor), type), maxFragment);
  const count = Math.max(encoder.fragmentsLength, 1);
  const parts: string[] = [];
  const total = count <= 1 ? 1 : count * 3;
  for (let index = 0; index < total; index += 1) {
    parts.push(encoder.nextPart());
  }
  return parts;
}

export class FountainUrDecoder {
  private decoder = new URDecoder();

  receive(part: string): UrProgress {
    const trimmed = part.trim();
    if (!trimmed.toLowerCase().startsWith('ur:')) {
      return this.snapshot();
    }
    try {
      this.decoder.receivePart(trimmed.toLowerCase());
    } catch {
      return this.snapshot();
    }
    return this.snapshot();
  }

  reset(): void {
    this.decoder = new URDecoder();
  }

  private snapshot(): UrProgress {
    const received = this.decoder.receivedPartIndexes().length;
    const expected = this.decoder.expectedPartCount();
    if (!this.decoder.isComplete()) {
      return { complete: false, received, expected };
    }
    if (!this.decoder.isSuccess()) {
      return {
        complete: true,
        success: false,
        received,
        expected,
        error: this.decoder.resultError() || 'errors.qrBadUr',
      };
    }
    const ur = this.decoder.resultUR();
    const payload = ur.cbor;
    return {
      complete: true,
      success: true,
      type: ur.type,
      cbor: Uint8Array.from(payload),
      received,
      expected,
    };
  }
}
