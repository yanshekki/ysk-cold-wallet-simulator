import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(rel: string): string {
  return readFileSync(path.join(import.meta.dirname, rel), 'utf8');
}

describe('idle auto-lock wiring', () => {
  it('starts an idle session on unlock instead of a fixed-from-unlock deadline', () => {
    const appState = source('./AppState.tsx');
    expect(appState).toContain('createIdleLockSession');
    expect(appState).toContain('idleRef.current?.start(minutesToIdleMs(settingsRef.current.autoLockMinutes))');
    expect(appState).not.toContain(
      'setUnlockedUntil(Date.now() + settingsRef.current.autoLockMinutes * 60 * 1000)',
    );
    expect(appState).toContain('setUserActivityReporter(onActivity)');
    expect(appState).toContain("Keyboard.addListener('keyboardDidShow', onActivity)");
    expect(appState).toContain('idleRef.current?.noteActivity()');
    expect(appState).toContain('userActivityViewProps()');
  });

  it('reports in-app touches from screens, shells, and native-portal sheets', () => {
    expect(source('../../../../packages/ui/src/Screen.tsx')).toContain('userActivityViewProps()');
    expect(source('../../../../packages/ui/src/Sheet.tsx')).toContain('userActivityViewProps()');
    expect(source('../../../../packages/ui/src/SelectSheet.tsx')).toContain('userActivityViewProps()');
    expect(source('../../../../packages/ui/src/GroupedSelectSheet.tsx')).toContain('userActivityViewProps()');
    expect(source('../../../../packages/ui/src/SigningModal.tsx')).toContain('userActivityViewProps()');
    expect(source('../../../../packages/ui/src/LogEditor.tsx')).toContain('userActivityViewProps()');
    expect(source('../../app/(app)/_layout.tsx')).toContain('userActivityViewProps()');
    expect(source('../../app/(app)/console.tsx')).toContain('userActivityViewProps()');
    expect(source('../signing/BleHostSheet.tsx')).toContain('userActivityViewProps()');
    expect(source('../qr/QrScanner.tsx')).toContain('userActivityViewProps()');
  });
});
