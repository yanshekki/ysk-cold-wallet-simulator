import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApduLogEntry } from '@cws/contracts';
import { colors, fonts, motion, radius, space } from './theme';

type Filter = 'all' | 'in' | 'out';

type Props = {
  entries: ApduLogEntry[];
  emptyLabel?: string;
  fill?: boolean;
  onCopyLast?: (hex: string) => void;
};

export function ApduLog({
  entries,
  emptyLabel = 'Waiting for host… advertise from Device.',
  fill,
  onCopyLast,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = useMemo(() => {
    if (filter === 'all') {
      return entries;
    }
    return entries.filter((entry) => entry.direction === filter);
  }, [entries, filter]);
  const last = visible[0];

  return (
    <View style={[styles.wrap, fill && styles.fill]}>
      <View style={styles.toolbar}>
        <View style={styles.chips}>
          <Chip label="ALL" active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="RX" active={filter === 'in'} onPress={() => setFilter('in')} />
          <Chip label="TX" active={filter === 'out'} onPress={() => setFilter('out')} />
        </View>
        {onCopyLast && last ? (
          <Pressable accessibilityRole="button" onPress={() => onCopyLast(last.hex)} hitSlop={6}>
            <Text style={styles.copy}>Copy last</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={[styles.box, fill && styles.boxFill]} contentContainerStyle={styles.inner}>
        {visible.length === 0 ? (
          <Text style={styles.empty}>{emptyLabel}</Text>
        ) : (
          visible.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipOn]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

function LogRow({ entry }: { entry: ApduLogEntry }) {
  const translateY = useRef(new Animated.Value(8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.enter,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.enter,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View style={[styles.row, { opacity, transform: [{ translateY }] }]}>
      <Text style={[styles.dir, entry.direction === 'in' ? styles.in : styles.out]}>
        {entry.direction === 'in' ? 'RX' : 'TX'}
      </Text>
      <View style={styles.copyCol}>
        {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
        <Text style={styles.hex}>{entry.hex}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    minHeight: 180,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipOn: {
    borderColor: colors.ok,
    backgroundColor: colors.bgElevated,
  },
  chipLabel: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  chipLabelOn: {
    color: colors.ok,
  },
  copy: {
    color: colors.ok,
    fontSize: 12,
    fontWeight: '700',
  },
  box: {
    minHeight: 180,
    maxHeight: 320,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  boxFill: {
    flex: 1,
    maxHeight: undefined,
    minHeight: 0,
  },
  inner: {
    padding: space.sm,
    gap: 8,
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  dir: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    width: 24,
    marginTop: 2,
  },
  in: {
    color: colors.ok,
  },
  out: {
    color: colors.accent,
  },
  copyCol: {
    flex: 1,
  },
  note: {
    color: colors.muted,
    fontSize: 11,
  },
  hex: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
});
