import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen, colors, space } from '@cws/ui';
import { ScanButton } from '../src/lab/ScanButton';
import { describeUnlock, type UnlockStatus } from '../src/passkeys';
import { useAppState } from '../src/state/AppState';

export default function UnlockScreen() {
  const { unlock, error } = useAppState();
  const [status, setStatus] = useState<UnlockStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const unlockDisabled = status?.kind === 'not-enrolled';

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const next = await describeUnlock();
        if (cancelled) {
          return;
        }
        setStatus(next);
        if (next.kind === 'dev-skip') {
          setBusy(true);
          try {
            await unlock();
          } finally {
            if (!cancelled) {
              setBusy(false);
            }
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [unlock]),
  );

  const onUnlock = async () => {
    setBusy(true);
    try {
      await unlock();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      kicker={null}
      title="YSK"
      subtitle={status?.message ?? 'Unlocking requires the platform authenticator.'}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScanButton
        label="Unlock"
        disabled={unlockDisabled}
        busy={busy}
        onPress={() => void onUnlock()}
      />
      {unlockDisabled ? (
        <Text style={styles.hint}>Enroll a lock screen PIN or biometric in system settings, then return here.</Text>
      ) : null}
      <View style={styles.rule} />
      <Text style={styles.meta}>Lab console · 15-minute session · never auto-sign</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    color: colors.danger,
  },
  hint: {
    color: colors.muted,
    lineHeight: 20,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: space.sm,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
