import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, motion, space } from './theme';

export type RadioMode = 'IDLE' | 'ADV' | 'GATT';

type Props = {
  sessionLabel: string;
  radio: RadioMode;
  host?: string;
  onLock?: () => void;
};

export function formatSessionRemaining(unlockedUntil: number | null, now = Date.now()): string {
  if (unlockedUntil == null || unlockedUntil <= now) {
    return 'LOCKED';
  }
  const total = Math.max(0, Math.floor((unlockedUntil - now) / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function radioMode(advertising: boolean, connected: boolean): RadioMode {
  if (connected) {
    return 'GATT';
  }
  if (advertising) {
    return 'ADV';
  }
  return 'IDLE';
}

export function Hud({ sessionLabel, radio, host, onLock }: Props) {
  const locked = sessionLabel === 'LOCKED';
  const live = radio !== 'IDLE';

  return (
    <View style={styles.bar}>
      <View style={styles.cluster}>
        <Text style={[styles.kicker, locked && styles.locked]}>{locked ? 'LOCKED' : sessionLabel}</Text>
      </View>
      <View style={styles.cluster}>
        <RadioPip active={live} />
        <Text style={[styles.radio, live && styles.radioOn]}>{radio}</Text>
      </View>
      <View style={[styles.cluster, styles.hostCluster]}>
        <Text style={styles.host} numberOfLines={1}>
          {host ? host : 'NO HOST'}
        </Text>
        {onLock ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Lock session" onPress={onLock} hitSlop={8}>
            <Text style={styles.lock}>LOCK</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function RadioPip({ active }: { active: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.28,
          duration: motion.radioPulse / 2,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: motion.radioPulse / 2,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [active, opacity]);

  return <Animated.View style={[styles.pip, active && styles.pipOn, { opacity }]} />;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hostCluster: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  kicker: {
    color: colors.ok,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  locked: {
    color: colors.danger,
  },
  pip: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.muted,
  },
  pipOn: {
    backgroundColor: colors.ok,
  },
  radio: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  radioOn: {
    color: colors.ok,
  },
  host: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  lock: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
