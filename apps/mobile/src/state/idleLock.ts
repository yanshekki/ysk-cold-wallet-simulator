export function minutesToIdleMs(minutes: number): number {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n < 1) {
    return 60_000;
  }
  return n * 60 * 1000;
}

export function idleDeadline(lastActivityAt: number, idleMs: number): number {
  return lastActivityAt + idleMs;
}

export function shouldIdleLock(deadline: number | null, now: number): boolean {
  return deadline != null && now >= deadline;
}

export type IdleLockClock = {
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => () => void;
};

const defaultClock: IdleLockClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => {
    const id = setTimeout(callback, delayMs);
    return () => clearTimeout(id);
  },
};

export type IdleLockSession = {
  start: (idleMs: number) => number;
  noteActivity: () => number | null;
  setIdleMs: (idleMs: number) => number | null;
  stop: () => void;
  deadline: () => number | null;
  isArmed: () => boolean;
};

/**
 * Idle auto-lock: the countdown is unused time, not elapsed time since unlock.
 * `noteActivity` restarts the full idle window. `onLock` runs once when the
 * window expires with no activity.
 */
export function createIdleLockSession(onLock: () => void, clock: IdleLockClock = defaultClock): IdleLockSession {
  let lastActivityAt: number | null = null;
  let idleMs = 0;
  let armed = false;
  let cancel: (() => void) | null = null;
  let locking = false;

  function deadline(): number | null {
    if (!armed || lastActivityAt == null) {
      return null;
    }
    return idleDeadline(lastActivityAt, idleMs);
  }

  function clearTimer(): void {
    cancel?.();
    cancel = null;
  }

  function fireLock(): void {
    if (locking || !armed) {
      return;
    }
    locking = true;
    clearTimer();
    armed = false;
    lastActivityAt = null;
    try {
      onLock();
    } finally {
      locking = false;
    }
  }

  function armTimer(): void {
    clearTimer();
    if (!armed || lastActivityAt == null) {
      return;
    }
    const remaining = idleDeadline(lastActivityAt, idleMs) - clock.now();
    if (remaining <= 0) {
      fireLock();
      return;
    }
    cancel = clock.setTimer(() => {
      cancel = null;
      const due = deadline();
      if (due == null || clock.now() < due) {
        armTimer();
        return;
      }
      fireLock();
    }, remaining);
  }

  return {
    start(nextIdleMs: number) {
      idleMs = nextIdleMs;
      lastActivityAt = clock.now();
      armed = true;
      armTimer();
      return deadline() ?? idleDeadline(lastActivityAt, idleMs);
    },
    noteActivity() {
      if (!armed) {
        return null;
      }
      lastActivityAt = clock.now();
      armTimer();
      return deadline();
    },
    setIdleMs(nextIdleMs: number) {
      idleMs = nextIdleMs;
      if (!armed) {
        return null;
      }
      armTimer();
      return deadline();
    },
    stop() {
      clearTimer();
      armed = false;
      lastActivityAt = null;
    },
    deadline,
    isArmed: () => armed,
  };
}
