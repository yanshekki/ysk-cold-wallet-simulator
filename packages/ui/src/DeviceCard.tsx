import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { bleAdvertiseName, type DeviceModel } from '@cws/contracts';
import { BRAND_LABEL, brandColor, colors, fonts, hairline, radius, space } from './theme';

type Props = {
  model: DeviceModel;
  selected?: boolean;
  enabled?: boolean;
  badge?: string;
  onSelect: () => void;
  onCopyUuid?: () => void;
  onCopyName?: () => void;
  localName?: string;
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
  localName,
  children,
}: Props) {
  const rail = brandColor(model.brand);

  return (
    <View style={[styles.card, selected && styles.selected, !enabled && styles.disabled]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={model.name}
        accessibilityState={{ disabled: !enabled, selected: !!selected }}
        testID={`device-model-${model.id}`}
        disabled={!enabled}
        onPress={onSelect}
        style={styles.hit}
      >
        <View style={styles.head}>
          <Text style={[styles.brand, { color: rail }]}>{BRAND_LABEL[model.brand]}</Text>
          <Text style={styles.protocol}>{model.protocol}</Text>
        </View>
        <Text style={styles.name}>{model.name}</Text>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      </Pressable>
      {selected && enabled ? (
        <View style={styles.bezel}>
          <Text style={styles.meta}>Local name</Text>
          <Text style={styles.mono}>{localName ?? bleAdvertiseName(model)}</Text>
          <Text style={styles.meta}>Service UUID</Text>
          <Text style={styles.mono} selectable>
            {model.serviceUUID}
          </Text>
          <View style={styles.copies}>
            {onCopyName ? (
              <Pressable
                testID="device-copy-name"
                accessibilityRole="button"
                onPress={onCopyName}
                hitSlop={6}
              >
                <Text style={styles.copy}>Copy name</Text>
              </Pressable>
            ) : null}
            {onCopyUuid ? (
              <Pressable
                testID="device-copy-uuid"
                accessibilityRole="button"
                onPress={onCopyUuid}
                hitSlop={6}
              >
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
    borderWidth: hairline,
    borderRadius: radius.sm,
  },
  selected: {
    borderColor: colors.accent,
  },
  disabled: {
    opacity: 0.45,
  },
  hit: {
    padding: space.md,
    gap: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  brand: {
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  name: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 16,
  },
  protocol: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
  },
  badge: {
    marginTop: 2,
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
  },
  bezel: {
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    padding: space.md,
    gap: 6,
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
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
    fontFamily: fonts.monoMedium,
    fontSize: 11,
  },
});
