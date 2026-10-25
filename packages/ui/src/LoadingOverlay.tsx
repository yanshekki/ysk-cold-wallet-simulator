import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  visible: boolean;
  label?: string;
};

export function LoadingOverlay({ visible, label = 'Loading' }: Props) {
  if (!visible) {
    return null;
  }
  return (
    <View style={styles.wrap} pointerEvents="auto" accessibilityViewIsModal>
      <View style={styles.card}>
        <ActivityIndicator color={colors.ok} />
        <Text style={styles.label}>{label}</Text>
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
  },
  label: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    letterSpacing: 1.2,
  },
});
