import { base32 } from '@scure/base';
import { unzlibSync, zlibSync } from 'fflate';

const MAGIC = 'B$';
const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type BbqrFileType = 'P' | 'T' | 'J' | 'U' | 'H' | 'S';
export type BbqrEncoding = '2' | 'H' | 'Z';

export type BbqrEncodeOptions = {
  maxPiece?: number;
  encoding?: BbqrEncoding;
};

export type BbqrProgress = {
  complete: boolean;
  success?: boolean;
  type?: BbqrFileType;
  payload?: Uint8Array;
  received: number;
  expected: number;
  error?: string;
};

function toBase36(value: number, width: number): string {
  let next = value;
  let out = '';
  for (let index = 0; index < width; index += 1) {
    out = BASE36[next % 36] + out;
    next = Math.floor(next / 36);
  }
  return out;
}

function fromBase36(text: string): number {
  let value = 0;
  for (const char of text.toUpperCase()) {
    const digit = BASE36.indexOf(char);
    if (digit < 0) {
      throw new Error('errors.qrBadUr');
    }
    value = value * 36 + digit;
  }
  return value;
}

function encodeBase32(bytes: Uint8Array): string {
  return base32.encode(bytes).replace(/=+$/, '');
}

function decodeBase32(text: string): Uint8Array {
  const padded = text + '='.repeat((8 - (text.length % 8)) % 8);
  return base32.decode(padded.toUpperCase());
}

function resolveOptions(maxPieceOrOptions?: number | BbqrEncodeOptions): { maxPiece: number; encoding: BbqrEncoding } {
  if (typeof maxPieceOrOptions === 'object' && maxPieceOrOptions) {
    return {
      maxPiece: maxPieceOrOptions.maxPiece ?? 180,
      encoding: maxPieceOrOptions.encoding ?? '2',
    };
  }
  return { maxPiece: maxPieceOrOptions ?? 180, encoding: '2' };
}

function encodeBody(payload: Uint8Array, encoding: BbqrEncoding): string {
  if (encoding === 'H') {
    return Array.from(payload, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const bytes = encoding === 'Z' ? zlibSync(payload, { level: 9 }) : payload;
  return encodeBase32(bytes);
}

function decodeBody(body: string, encoding: string): Uint8Array {
  if (encoding === 'H') {
    return hexToBytes(body);
  }
  if (encoding === '2') {
    return decodeBase32(body);
  }
  if (encoding === 'Z') {
    return unzlibSync(decodeBase32(body));
  }
  throw new Error('errors.qrUnsupported');
}

export function encodeBbqr(
  fileType: BbqrFileType,
  payload: Uint8Array,
  maxPieceOrOptions: number | BbqrEncodeOptions = 180,
): { frames: string[] } {
  const { maxPiece, encoding } = resolveOptions(maxPieceOrOptions);
  const body = encodeBody(payload, encoding);
  const count = Math.max(1, Math.ceil(body.length / maxPiece));
  const size = Math.ceil(body.length / count);
  const frames: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const piece = body.slice(index * size, (index + 1) * size);
    frames.push(`${MAGIC}${encoding}${fileType}${toBase36(index, 2)}${toBase36(count, 2)}${piece}`);
  }
  return { frames };
}

export function encodeBbqrParts(
  fileType: BbqrFileType,
  payload: Uint8Array,
  maxPieceOrOptions: number | BbqrEncodeOptions = 180,
): string[] {
  return encodeBbqr(fileType, payload, maxPieceOrOptions).frames;
}

export function parseBbqrPart(part: string): {
  encoding: string;
  type: BbqrFileType;
  index: number;
  total: number;
  body: string;
} {
  const trimmed = part.trim().toUpperCase();
  if (!trimmed.startsWith(MAGIC) || trimmed.length < 8) {
    throw new Error('errors.qrBadUr');
  }
  const encoding = trimmed[2]!;
  const type = trimmed[3] as BbqrFileType;
  if (!'PTJUHS'.includes(type)) {
    throw new Error('errors.qrWrongType');
  }
  return {
    encoding,
    type,
    index: fromBase36(trimmed.slice(4, 6)),
    total: fromBase36(trimmed.slice(6, 8)),
    body: trimmed.slice(8),
  };
}

export class BbqrDecoder {
  private parts = new Map<number, string>();
  private total = 0;
  private type: BbqrFileType | undefined;
  private encoding = '2';

  receive(part: string): BbqrProgress {
    const trimmed = part.trim();
    if (!trimmed.toUpperCase().startsWith(MAGIC)) {
      return this.snapshot();
    }
    try {
      const parsed = parseBbqrPart(trimmed);
      if (this.total && parsed.total !== this.total) {
        return { complete: true, success: false, received: this.parts.size, expected: this.total, error: 'errors.qrBadUr' };
      }
      this.total = parsed.total;
      this.type = parsed.type;
      this.encoding = parsed.encoding;
      this.parts.set(parsed.index, parsed.body);
    } catch (error) {
      return {
        complete: true,
        success: false,
        received: this.parts.size,
        expected: this.total,
        error: error instanceof Error ? error.message : 'errors.qrBadUr',
      };
    }
    return this.snapshot();
  }

  reset(): void {
    this.parts.clear();
    this.total = 0;
    this.type = undefined;
    this.encoding = '2';
  }

  private snapshot(): BbqrProgress {
    const received = this.parts.size;
    const expected = this.total;
    if (!expected || received < expected) {
      return { complete: false, received, expected };
    }
    const body = Array.from({ length: expected }, (_, index) => this.parts.get(index) ?? '').join('');
    try {
      const payload = decodeBody(body, this.encoding);
      return { complete: true, success: true, type: this.type, payload, received, expected };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'errors.qrBadUr';
      return {
        complete: true,
        success: false,
        received,
        expected,
        error: message === 'errors.qrUnsupported' ? 'errors.qrUnsupported' : 'errors.qrBadUr',
      };
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function isBbqrPart(part: string): boolean {
  return part.trim().toUpperCase().startsWith(MAGIC);
}
