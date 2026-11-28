export const USER_ACTIVITY_MOVE_THROTTLE_MS = 1000;

type Reporter = () => void;

let reporter: Reporter | null = null;
let lastMoveAt = 0;

export function setUserActivityReporter(next: Reporter | null): void {
  reporter = next;
}

export function reportUserActivity(): void {
  reporter?.();
}

export function reportUserActivityMove(now = Date.now()): void {
  if (now - lastMoveAt < USER_ACTIVITY_MOVE_THROTTLE_MS) {
    return;
  }
  lastMoveAt = now;
  reporter?.();
}

export function userActivityViewProps(): {
  onTouchStart: () => void;
  onTouchMove: () => void;
} {
  return {
    onTouchStart: reportUserActivity,
    onTouchMove: reportUserActivityMove,
  };
}

export function resetUserActivityForTests(): void {
  reporter = null;
  lastMoveAt = 0;
}
