import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Screen, colors, fonts } from '@cws/ui';
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
      subtitle={status ? t(status.message) : t('unlock.fallback')}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScanButton
        label={t('unlock.button')}
        busyLabel={t('common.unlocking')}
        disabled={unlockDisabled}
        busy={busy}
        onPress={() => void onUnlock()}
      />
      {unlockDisabled ? <Text style={styles.hint}>{t('unlock.enroll')}</Text> : null}
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
});
