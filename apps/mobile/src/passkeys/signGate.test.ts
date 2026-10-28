import { describe, expect, it } from 'vitest';
import { needsSignReauth } from './signGate';

describe('needsSignReauth', () => {
  it('re-authenticates signatures and seed export in release even when the toggle is off', () => {
    expect(needsSignReauth({ kind: 'sign', signReauth: false, devBuild: false })).toBe(true);
    expect(needsSignReauth({ kind: 'export-seed', signReauth: false, devBuild: false })).toBe(true);
  });

  it('lets a debug build skip re-auth only when the toggle is off', () => {
    expect(needsSignReauth({ kind: 'sign', signReauth: false, devBuild: true })).toBe(false);
    expect(needsSignReauth({ kind: 'export-seed', signReauth: false, devBuild: true })).toBe(false);
    expect(needsSignReauth({ kind: 'sign', signReauth: true, devBuild: true })).toBe(true);
    expect(needsSignReauth({ kind: 'export-seed', signReauth: true, devBuild: true })).toBe(true);
  });

  it('does not re-authenticate address export or app open', () => {
    expect(needsSignReauth({ kind: 'address', signReauth: true, devBuild: false })).toBe(false);
    expect(needsSignReauth({ kind: 'open-app', signReauth: true, devBuild: false })).toBe(false);
    expect(needsSignReauth({ kind: undefined, signReauth: true, devBuild: false })).toBe(false);
  });
});
