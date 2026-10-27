import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { shouldCommitSlide, slideProgress } from '@cws/contracts';
import { colors, fonts, hairline, radius, space } from './theme';

const THUMB = 46;
const INSET = 4;
const FLICK_VELOCITY = 650;

type Props = {
  label: string;
  onConfirm: () => void;
  resetKey?: string;
};

export function SlideToConfirm({ label, onConfirm, resetKey }: Props) {
  const translate = useRef(new Animated.Value(0)).current;
  const travelRef = useRef(0);
  const committedRef = useRef(false);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    committedRef.current = false;
    translate.stopAnimation();
    translate.setValue(0);
  }, [resetKey, translate]);

  const finish = (travel: number) => {
    if (committedRef.current) {
      return;
    }
    committedRef.current = true;
    Animated.timing(translate, {
      toValue: travel,
      duration: 90,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        onConfirmRef.current();
      }
    });
  };

  const clampToTrack = (x: number) => {
    const travel = travelRef.current;
    if (travel <= 0) {
      return 0;
    }
    return Math.min(travel, Math.max(0, x - THUMB / 2));
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        .onBegin((event) => {
          if (committedRef.current) {
            return;
          }
          translate.stopAnimation();
          translate.setValue(clampToTrack(event.x));
        })
        .onUpdate((event) => {
          if (committedRef.current || travelRef.current <= 0) {
            return;
          }
          const next = clampToTrack(event.x);
          translate.setValue(next);
          if (shouldCommitSlide(slideProgress(next, travelRef.current))) {
            finish(travelRef.current);
          }
        })
        .onFinalize((event) => {
          if (committedRef.current || travelRef.current <= 0) {
            return;
          }
          const next = clampToTrack(event.x);
          const flicked = event.velocityX > FLICK_VELOCITY;
          if (flicked || shouldCommitSlide(slideProgress(next, travelRef.current))) {
            finish(travelRef.current);
            return;
          }
          Animated.timing(translate, {
            toValue: 0,
            duration: 140,
            useNativeDriver: false,
          }).start();
        }),
    [translate],
  );

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      testID="signing-slide"
      style={styles.track}
      onLayout={(event) => {
        travelRef.current = Math.max(0, event.nativeEvent.layout.width - THUMB - INSET * 2);
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { width: Animated.add(translate, THUMB) }]}
      />
      <Text style={styles.label} pointerEvents="none">
        {label}
      </Text>
      <Animated.View
        pointerEvents="none"
        style={[styles.thumb, { transform: [{ translateX: translate }] }]}
      />
      <GestureDetector gesture={pan}>
        <View collapsable={false} style={styles.hit} />
      </GestureDetector>
    </View>
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
    paddingHorizontal: INSET,
  },
  fill: {
    position: 'absolute',
    left: INSET,
    top: INSET,
    height: THUMB,
    borderRadius: radius.sm,
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
    paddingLeft: space.lg,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  hit: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
