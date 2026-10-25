import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts, radius, space } from '@cws/ui';

type Props = {
  label: string;
  busyLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
};

export function ScanButton({ label, busyLabel = 'Unlocking…', onPress, disabled, busy }: Props) {
  const travel = useSharedValue(-1);

  useEffect(() => {
    if (!busy) {
      cancelAnimation(travel);
      travel.value = -1;
      return;
    }
    travel.value = -1;
    travel.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [busy, travel]);

  const scanStyle = useAnimatedStyle(() => ({
    opacity: busy ? 1 : 0,
    transform: [{ translateX: travel.value * 160 }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        (disabled || busy) && styles.disabled,
        pressed && !disabled && !busy && styles.pressed,
      ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.scan, scanStyle]} />
      </View>
      <Text style={styles.label}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: colors.accent,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
  },
  scan: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 72,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  label: {
    color: colors.bg,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: 0.4,
  },
});
