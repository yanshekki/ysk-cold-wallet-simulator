import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen, colors, fonts, hairline, space } from '@cws/ui';
import { useT } from '../src/i18n';
import { ScanButton } from '../src/lab/ScanButton';
import { describeUnlock, type UnlockStatus } from '../src/passkeys';
import { useAppState } from '../src/state/AppState';

export default function UnlockScreen() {
  const t = useT();
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
      title={t('unlock.title')}
      subtitle={status?.message ?? t('unlock.fallback')}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScanButton
        label={t('unlock.button')}
        disabled={unlockDisabled}
        busy={busy}
        onPress={() => void onUnlock()}
      />
      {unlockDisabled ? (
        <Text style={styles.hint}>{t('unlock.enroll')}</Text>
      ) : null}
      <View style={styles.rule} />
      <Text style={styles.meta}>{t('unlock.meta')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    color: colors.danger,
    fontFamily: fonts.sans,
  },
  hint: {
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
  rule: {
    height: hairline,
    backgroundColor: colors.border,
    marginTop: space.sm,
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.6,
  },
});
