import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIdleLockSession,
  idleDeadline,
  minutesToIdleMs,
  shouldIdleLock,
} from './idleLock';

describe('idle auto-lock math', () => {
  it('treats Settings minutes as idle duration, not a one-shot elapsed lock', () => {
    expect(minutesToIdleMs(15)).toBe(15 * 60 * 1000);
    expect(minutesToIdleMs(1)).toBe(60_000);
    expect(minutesToIdleMs(0)).toBe(60_000);
    expect(minutesToIdleMs(Number.NaN)).toBe(60_000);
    expect(idleDeadline(1_000, 60_000)).toBe(61_000);
    expect(shouldIdleLock(null, 10_000)).toBe(false);
    expect(shouldIdleLock(10_000, 9_999)).toBe(false);
    expect(shouldIdleLock(10_000, 10_000)).toBe(true);
  });
});

describe('createIdleLockSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks after the configured idle window with no activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00.000Z'));
    const onLock = vi.fn();
    const session = createIdleLockSession(onLock);

    expect(session.start(15_000)).toBe(Date.now() + 15_000);
    vi.advanceTimersByTime(14_999);
    expect(onLock).not.toHaveBeenCalled();
    expect(session.isArmed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(session.isArmed()).toBe(false);
    expect(session.deadline()).toBeNull();
  });

  it('does not lock at T from unlock when activity arrives inside the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00.000Z'));
    const onLock = vi.fn();
    const session = createIdleLockSession(onLock);
    const idleMs = 60_000;

    session.start(idleMs);
    vi.advanceTimersByTime(idleMs / 2);
    expect(session.noteActivity()).toBe(Date.now() + idleMs);

    // Old fixed-from-unlock timer would fire here (T = start + idleMs).
    vi.advanceTimersByTime(idleMs / 2);
    expect(onLock).not.toHaveBeenCalled();
    expect(session.isArmed()).toBe(true);

    vi.advanceTimersByTime(idleMs);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('does not lock while activity keeps arriving inside the idle window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00.000Z'));
    const onLock = vi.fn();
    const session = createIdleLockSession(onLock);
    const idleMs = 10_000;

    session.start(idleMs);
    for (let i = 0; i < 8; i += 1) {
      vi.advanceTimersByTime(idleMs - 1);
      expect(session.noteActivity()).not.toBeNull();
    }
    expect(onLock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(idleMs);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('ignores activity after stop and does not start a session from noteActivity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00.000Z'));
    const onLock = vi.fn();
    const session = createIdleLockSession(onLock);

    session.start(5_000);
    session.stop();
    expect(session.noteActivity()).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it('recomputes the remaining idle window when Settings minutes change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00.000Z'));
    const onLock = vi.fn();
    const session = createIdleLockSession(onLock);

    session.start(60_000);
    vi.advanceTimersByTime(10_000);
    expect(session.setIdleMs(15_000)).toBe(Date.now() + 5_000);
    vi.advanceTimersByTime(4_999);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});
