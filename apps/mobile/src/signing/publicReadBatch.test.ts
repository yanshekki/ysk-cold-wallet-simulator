import { describe, expect, it } from 'vitest';
import { PUBLIC_READ_BATCH, PUBLIC_READ_BATCH_MS, PublicReadBatch } from './publicReadBatch';

describe('PublicReadBatch', () => {
  it('covers later public reads after one grant and then expires', () => {
    let now = 1_000;
    const batch = new PublicReadBatch(() => now);
    expect(batch.take()).toBe(false);
    batch.grant();
    expect(batch.take()).toBe(true);
    now += PUBLIC_READ_BATCH_MS;
    expect(batch.take()).toBe(true);
    now += 1;
    expect(batch.take()).toBe(false);
  });

  it('stops after the batch count and reset', () => {
    const batch = new PublicReadBatch(() => 0);
    batch.grant(3, 10);
    expect(batch.take()).toBe(true);
    expect(batch.take()).toBe(true);
    expect(batch.take()).toBe(false);
    batch.grant(PUBLIC_READ_BATCH);
    batch.reset();
    expect(batch.take()).toBe(false);
  });
});
