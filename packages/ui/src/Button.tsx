import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  testID?: string;
};

export function Button({ label, onPress, variant = 'primary', disabled, testID }: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      collapsable={false}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          variant === 'primary' && styles.primaryLabel,
          variant === 'ghost' && styles.ghostLabel,
          variant === 'danger' && styles.dangerLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    flexDirection: 'row',
    flexShrink: 0,
    ...Platform.select({
      ios: { overflow: 'hidden' as const },
      default: {},
    }),
  },
  primary: {
    backgroundColor: colors.accent,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: hairline,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: 'transparent',
    borderWidth: hairline,
    borderColor: colors.danger,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.82,
  },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    letterSpacing: Platform.OS === 'android' ? 0 : 0.4,
    includeFontPadding: false,
    flexShrink: 0,
    textAlign: 'center',
  },
  primaryLabel: {
    color: colors.onAccent,
  },
  ghostLabel: {
    color: colors.text,
  },
  dangerLabel: {
    color: colors.danger,
  },
});
