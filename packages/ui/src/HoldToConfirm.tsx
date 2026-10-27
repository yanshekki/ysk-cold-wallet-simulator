import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import {
  HOLD_CONFIRM_DEFAULT_SECONDS,
  holdDurationMs,
  holdProgress,
  shouldCommitHold,
} from '@cws/contracts';
import { colors, fonts, hairline, radius } from './theme';

type Props = {
  label: string;
  onConfirm: () => void;
  resetKey?: string;
  durationSeconds?: number;
};

export function HoldToConfirm({
  label,
  onConfirm,
  resetKey,
  durationSeconds = HOLD_CONFIRM_DEFAULT_SECONDS,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const [holding, setHolding] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const committedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const durationMsRef = useRef(holdDurationMs(durationSeconds));
  durationMsRef.current = holdDurationMs(durationSeconds);

  const stopFrame = () => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  useEffect(() => {
    committedRef.current = false;
    stopFrame();
    setHolding(false);
    setRemainingMs(0);
    progress.stopAnimation();
    progress.setValue(0);
    return stopFrame;
  }, [resetKey, progress]);

  const finish = () => {
    if (committedRef.current) {
      return;
    }
    committedRef.current = true;
    stopFrame();
    setHolding(false);
    progress.setValue(1);
    onConfirmRef.current();
  };

  const onPressIn = () => {
    if (committedRef.current) {
      return;
    }
    const duration = durationMsRef.current;
    const startedAt = Date.now();
    stopFrame();
    progress.stopAnimation();
    progress.setValue(0);
    setHolding(true);
    setRemainingMs(duration);

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      progress.setValue(holdProgress(elapsed, duration));
      setRemainingMs(Math.max(0, duration - elapsed));
      if (shouldCommitHold(elapsed, duration)) {
        finish();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  const onPressOut = () => {
    if (committedRef.current) {
      return;
    }
    stopFrame();
    setHolding(false);
    setRemainingMs(0);
    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: 0,
      duration: 140,
      useNativeDriver: false,
    }).start();
  };

  const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
  const fillWidth = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.max(0, trackWidth)],
      }),
    [progress, trackWidth],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: holding }}
      testID="signing-hold"
      collapsable={false}
      unstable_pressDelay={0}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.track}
      onLayout={(event) => {
        setTrackWidth(event.nativeEvent.layout.width);
      }}
    >
      <Animated.View pointerEvents="none" style={[styles.fill, { width: fillWidth }]} />
      <Text style={[styles.label, holding && styles.labelActive]} pointerEvents="none">
        {label}
      </Text>
      {holding ? (
        <Text testID="signing-hold-remaining" style={styles.countdown} pointerEvents="none">
          {remainingSec}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: hairline,
    borderColor: colors.border,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accent,
    opacity: 0.28,
  },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  labelActive: {
    color: colors.text,
  },
  countdown: {
    position: 'absolute',
    right: 16,
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 14,
    letterSpacing: 0.6,
  },
});
