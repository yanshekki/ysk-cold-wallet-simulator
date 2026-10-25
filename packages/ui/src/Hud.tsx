import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, hairline, motion, space } from './theme';

export type RadioMode = 'IDLE' | 'ADV' | 'GATT';

type Props = {
  sessionLabel: string;
  radio: RadioMode;
  host?: string;
  appChip?: string;
  seedLabel?: string;
  onLock?: () => void;
  lockLabel?: string;
  noHostLabel?: string;
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

export function Hud({
  sessionLabel,
  radio,
  host,
  appChip,
  seedLabel,
  onLock,
  lockLabel = 'LOCK',
  noHostLabel = 'NO HOST',
}: Props) {
  const locked = sessionLabel === 'LOCKED';
  const live = radio !== 'IDLE';
  const clock = locked ? 'LOCKED' : seedLabel ? `${seedLabel} · ${sessionLabel}` : sessionLabel;

  return (
    <View style={styles.bar}>
      <View style={styles.cluster}>
        <Text style={[styles.kicker, locked && styles.locked]} numberOfLines={1}>
          {clock}
        </Text>
      </View>
      <View style={styles.cluster}>
        <RadioPip active={live} />
        <Text style={[styles.radio, live && styles.radioOn]}>{radio}</Text>
      </View>
      {appChip ? (
        <View style={styles.cluster}>
          <Text style={[styles.chip, live && styles.chipOn]}>{appChip}</Text>
        </View>
      ) : null}
      <View style={[styles.cluster, styles.hostCluster]}>
        <Text style={styles.host} numberOfLines={1}>
          {host ? host : noHostLabel}
        </Text>
        {onLock ? (
          <Pressable accessibilityRole="button" accessibilityLabel={lockLabel} onPress={onLock} hitSlop={8}>
            <Text style={styles.lock}>{lockLabel}</Text>
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
    paddingVertical: 8,
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.border,
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
    fontFamily: fonts.monoBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  locked: {
    color: colors.danger,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: colors.muted,
  },
  pipOn: {
    backgroundColor: colors.ok,
  },
  radio: {
    color: colors.muted,
    fontFamily: fonts.monoBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  radioOn: {
    color: colors.ok,
  },
  chip: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 0.6,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
    borderRadius: 2,
  },
  chipOn: {
    color: colors.ok,
    borderColor: colors.ok,
  },
  host: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  lock: {
    color: colors.danger,
    fontFamily: fonts.monoBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
});
