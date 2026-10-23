import { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { shouldCommitSlide, slideProgress } from '@cws/contracts';
import { colors, space } from './theme';

const THUMB = 48;
const INSET = 4;

type Props = {
  label: string;
  onConfirm: () => void;
  resetKey?: string;
};

export function SlideToConfirm({ label, onConfirm, resetKey }: Props) {
  const translate = useRef(new Animated.Value(0)).current;
  const travelRef = useRef(0);
  const committedRef = useRef(false);

  useEffect(() => {
    committedRef.current = false;
    translate.setValue(0);
  }, [resetKey, translate]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !committedRef.current,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4,
        onPanResponderMove: (_, gesture) => {
          if (committedRef.current) {
            return;
          }
          const next = Math.min(travelRef.current, Math.max(0, gesture.dx));
          translate.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          if (committedRef.current) {
            return;
          }
          const next = Math.min(travelRef.current, Math.max(0, gesture.dx));
          const progress = slideProgress(next, travelRef.current);
          if (shouldCommitSlide(progress)) {
            committedRef.current = true;
            Animated.timing(translate, {
              toValue: travelRef.current,
              duration: 80,
              useNativeDriver: true,
            }).start(() => onConfirm());
            return;
          }
          Animated.spring(translate, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        },
      }),
    [onConfirm, translate],
  );

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      style={styles.track}
      onLayout={(event) => {
        travelRef.current = Math.max(0, event.nativeEvent.layout.width - THUMB - INSET * 2);
      }}
    >
      <Text style={styles.label}>{label}</Text>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.thumb, { transform: [{ translateX: translate }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: INSET,
  },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingLeft: space.lg,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
});
