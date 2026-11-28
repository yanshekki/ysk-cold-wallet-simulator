import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  USER_ACTIVITY_MOVE_THROTTLE_MS,
  reportUserActivity,
  reportUserActivityMove,
  resetUserActivityForTests,
  setUserActivityReporter,
  userActivityViewProps,
} from './userActivity';

describe('user activity reporter', () => {
  afterEach(() => {
    resetUserActivityForTests();
  });

  it('forwards reports only while a reporter is registered', () => {
    const fn = vi.fn();
    reportUserActivity();
    expect(fn).not.toHaveBeenCalled();
    setUserActivityReporter(fn);
    reportUserActivity();
    reportUserActivity();
    expect(fn).toHaveBeenCalledTimes(2);
    setUserActivityReporter(null);
    reportUserActivity();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throttles move reports so a scroll does not flood the session', () => {
    const fn = vi.fn();
    setUserActivityReporter(fn);
    reportUserActivityMove(1_000);
    reportUserActivityMove(1_000 + USER_ACTIVITY_MOVE_THROTTLE_MS - 1);
    expect(fn).toHaveBeenCalledTimes(1);
    reportUserActivityMove(1_000 + USER_ACTIVITY_MOVE_THROTTLE_MS);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exposes touch handlers that report start immediately', () => {
    const fn = vi.fn();
    setUserActivityReporter(fn);
    const props = userActivityViewProps();
    props.onTouchStart();
    props.onTouchStart();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
