/** One confirm covers the first public read plus this many later reads. */
export const PUBLIC_READ_BATCH = 16;
/** Later reads in the batch must arrive before this window ends. */
export const PUBLIC_READ_BATCH_MS = 60_000;

/**
 * Hot-wallet list policy. The first address or xpub read opens a sheet.
 * The next reads in the window do not. A signature is never included.
 */
export class PublicReadBatch {
  private remaining = 0;
  private until = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  take(): boolean {
    if (this.remaining <= 0 || this.now() > this.until) {
      this.remaining = 0;
      return false;
    }
    this.remaining -= 1;
    return true;
  }

  grant(count = PUBLIC_READ_BATCH, windowMs = PUBLIC_READ_BATCH_MS): void {
    this.remaining = Math.max(0, count - 1);
    this.until = this.now() + windowMs;
  }

  reset(): void {
    this.remaining = 0;
    this.until = 0;
  }
}
