import { forwardRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
};

export const Button = forwardRef<View, Props>(function Button(
  { label, onPress, variant = 'primary', disabled, busy, testID },
  ref,
) {
  const inactive = !!disabled || !!busy;
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      collapsable={false}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
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
});

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
