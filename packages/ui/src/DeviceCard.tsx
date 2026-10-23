import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DeviceModel } from '@cws/contracts';
import { BRAND_LABEL, brandColor, colors, fonts, radius, space } from './theme';

type Props = {
  model: DeviceModel;
  selected?: boolean;
  enabled?: boolean;
  badge?: string;
  onSelect: () => void;
  onCopyUuid?: () => void;
  onCopyName?: () => void;
  children?: ReactNode;
};

export function DeviceCard({
  model,
  selected,
  enabled = true,
  badge,
  onSelect,
  onCopyUuid,
  onCopyName,
  children,
}: Props) {
  const rail = brandColor(model.brand);

  return (
    <View
      style={[
        styles.card,
        { borderLeftColor: rail },
        selected && styles.selected,
        !enabled && styles.disabled,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={model.name}
        accessibilityState={{ disabled: !enabled, selected: !!selected }}
        disabled={!enabled}
        onPress={onSelect}
        style={styles.hit}
      >
        <Text style={[styles.brand, { color: rail }]}>{BRAND_LABEL[model.brand]}</Text>
        <Text style={styles.name}>{model.name}</Text>
        <Text style={styles.protocol}>{model.protocol}</Text>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      </Pressable>
      {selected && enabled ? (
        <View style={styles.bezel}>
          <Text style={styles.meta}>Local name</Text>
          <Text style={styles.mono}>{model.name}</Text>
          <Text style={styles.meta}>Service UUID</Text>
          <Text style={styles.mono} selectable>
            {model.serviceUUID}
          </Text>
          <View style={styles.copies}>
            {onCopyName ? (
              <Pressable accessibilityRole="button" onPress={onCopyName} hitSlop={6}>
                <Text style={styles.copy}>Copy name</Text>
              </Pressable>
            ) : null}
            {onCopyUuid ? (
              <Pressable accessibilityRole="button" onPress={onCopyUuid} hitSlop={6}>
                <Text style={styles.copy}>Copy UUID</Text>
              </Pressable>
            ) : null}
          </View>
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.bgElevated,
  },
  disabled: {
    opacity: 0.45,
  },
  hit: {
    padding: space.md,
    gap: 4,
  },
  brand: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  protocol: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  badge: {
    marginTop: 4,
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  bezel: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: space.md,
    gap: 6,
  },
  meta: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  mono: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  copies: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: 4,
  },
  copy: {
    color: colors.ok,
    fontSize: 12,
    fontWeight: '700',
  },
});
