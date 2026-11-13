import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { loadingOverlayA11y, overlayShowsAnimatedSpinner } from './loadingOverlayA11y';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  visible: boolean;
  label?: string;
};

export function LoadingOverlay({ visible, label = 'Loading' }: Props) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  if (!visible) {
    return null;
  }

  const a11y = loadingOverlayA11y(label);
  const animate = overlayShowsAnimatedSpinner(reduceMotion);

  return (
    <View
      style={styles.wrap}
      pointerEvents="auto"
      testID="loading-overlay"
      accessibilityViewIsModal={a11y.accessibilityViewIsModal}
      accessibilityRole={a11y.accessibilityRole}
      accessibilityLabel={a11y.accessibilityLabel}
      accessibilityLiveRegion={Platform.OS === 'android' ? a11y.accessibilityLiveRegion : undefined}
      importantForAccessibility="yes"
    >
      <View style={styles.card} accessible={false}>
        {animate ? (
          <ActivityIndicator color={colors.ok} />
        ) : (
          <View
            testID="loading-overlay-static"
            style={styles.staticMark}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        )}
        <Text style={styles.label} accessible={false}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(7, 8, 10, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: hairline,
    borderRadius: radius.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    alignItems: 'center',
    gap: space.md,
    minWidth: 160,
    maxWidth: 280,
  },
  staticMark: {
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: colors.ok,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
});
