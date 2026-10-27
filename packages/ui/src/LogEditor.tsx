import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import type { ApduLogEntry } from '@cws/contracts';
import { formatHex, formatTime } from './logFormat';
import {
  buildMatcher,
  clampFontSize,
  copyAllText,
  copyLineText,
  copyMatchText,
  exportLogText,
  filterEntries,
  LOG_CHANNELS,
  LOG_FONT_MAX,
  LOG_FONT_MIN,
  matchEntries,
  stepMatchIndex,
  type LogFilter,
} from './logQuery';
import { KeyboardAvoidingView } from './keyboard';
import { colors, fonts, hairline, radius, space } from './theme';

export type LogEditorLabels = {
  search?: string;
  all?: string;
  rx?: string;
  tx?: string;
  wrap?: string;
  follow?: string;
  prev?: string;
  next?: string;
  copyLine?: string;
  copyMatch?: string;
  copyAll?: string;
  export?: string;
  clear?: string;
  latest?: string;
};

type Props = {
  entries: readonly ApduLogEntry[];
  emptyLabel?: string;
  onCopy: (text: string) => void;
  onClear?: () => void;
  onExport?: (text: string) => void;
  labels?: LogEditorLabels;
};

export function LogEditor({
  entries,
  emptyLabel = 'Waiting for host',
  onCopy,
  onClear,
  onExport,
  labels,
}: Props) {
  const L = {
    search: labels?.search ?? 'Search',
    all: labels?.all ?? 'ALL',
    rx: labels?.rx ?? 'RX',
    tx: labels?.tx ?? 'TX',
    wrap: labels?.wrap ?? 'WRAP',
    follow: labels?.follow ?? 'FOLLOW',
    prev: labels?.prev ?? 'Prev',
    next: labels?.next ?? 'Next',
    copyLine: labels?.copyLine ?? 'Copy line',
    copyMatch: labels?.copyMatch ?? 'Copy match',
    copyAll: labels?.copyAll ?? 'Copy all',
    export: labels?.export ?? 'Export',
    clear: labels?.clear ?? 'Clear',
    latest: labels?.latest ?? 'Latest',
  };
  const [filter, setFilter] = useState<LogFilter>('all');
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const [fontSize, setFontSize] = useState(12);
  const [matchIndex, setMatchIndex] = useState(0);
  const list = useRef<FlatList<ApduLogEntry>>(null);

  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter]);

  const matcher = useMemo(
    () => buildMatcher(query, caseSensitive, regex),
    [caseSensitive, query, regex],
  );

  const matched = useMemo(() => matchEntries(filtered, query, matcher), [filtered, matcher, query]);

  const searching = Boolean(query) && !matcher.error;
  const visible = searching ? matched : filtered;
  const matchCount = searching ? matched.length : 0;

  const goPrev = () => {
    if (matchCount === 0) {
      return;
    }
    setFollow(false);
    setMatchIndex((index) => stepMatchIndex(index, matchCount, -1));
  };

  const goNext = () => {
    if (matchCount === 0) {
      return;
    }
    setFollow(false);
    setMatchIndex((index) => stepMatchIndex(index, matchCount, 1));
  };

  useEffect(() => {
    if (matchIndex >= matchCount) {
      setMatchIndex(0);
    }
  }, [matchCount, matchIndex]);

  useEffect(() => {
    if (searching && matchCount > 0) {
      try {
        list.current?.scrollToIndex({ index: matchIndex, animated: true, viewPosition: 0.15 });
      } catch {
        // item may not be measured yet
      }
      return;
    }
    if (follow && visible.length > 0) {
      requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false }));
    }
  }, [follow, matchCount, matchIndex, searching, visible.length]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 64;
    if (!atBottom && follow) {
      setFollow(false);
    }
  };

  const highlight = matcher.source ? new RegExp(matcher.source, matcher.flags) : null;

  const emitCopy = (text: string | null) => {
    if (text) {
      onCopy(text);
    }
  };

  const renderItem: ListRenderItem<ApduLogEntry> = useCallback(
    ({ item, index }) => (
      <LogLine
        entry={item}
        fontSize={fontSize}
        wrap={wrap}
        highlight={highlight}
        active={searching && index === matchIndex}
        onCopy={() => onCopy(formatHex(item.hex))}
      />
    ),
    [fontSize, highlight, matchIndex, onCopy, searching, wrap],
  );

  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.root}>
      <View style={styles.instrument}>
      <View style={styles.chips}>
        <Chip testID="log-filter-all" label={L.all} active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip testID="log-filter-in" label={L.rx} active={filter === 'in'} onPress={() => setFilter('in')} />
        <Chip testID="log-filter-out" label={L.tx} active={filter === 'out'} onPress={() => setFilter('out')} />
        {LOG_CHANNELS.map((channel) => (
          <Chip
            key={channel}
            testID={`log-filter-${channel}`}
            label={channel.toUpperCase()}
            active={filter === channel}
            onPress={() => setFilter(channel)}
          />
        ))}
        <Chip testID="log-wrap" label={L.wrap} active={wrap} onPress={() => setWrap((value) => !value)} />
        <Chip testID="log-follow" label={L.follow} active={follow} onPress={() => setFollow((value) => !value)} />
      </View>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setMatchIndex(0);
            setFollow(false);
          }}
          placeholder={L.search}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          blurOnSubmit={false}
          returnKeyType="search"
          style={styles.search}
          onSubmitEditing={goNext}
          testID="log-search"
          accessibilityLabel={L.search}
        />
        <Text style={styles.count} testID="log-count">
          {matcher.error ?? `${matchCount ? matchIndex + 1 : 0}/${matchCount}`}
        </Text>
        <Chip testID="log-case" label="Aa" active={caseSensitive} onPress={() => setCaseSensitive((value) => !value)} />
        <Chip testID="log-regex" label=".*" active={regex} onPress={() => setRegex((value) => !value)} />
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: matchCount === 0 }}
          testID="log-prev"
          onPress={goPrev}
        >
          <Text style={[styles.action, matchCount === 0 && styles.actionOff]}>{L.prev}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: matchCount === 0 }}
          testID="log-next"
          onPress={goNext}
        >
          <Text style={[styles.action, matchCount === 0 && styles.actionOff]}>{L.next}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="log-copy-line"
          onPress={() => emitCopy(copyLineText(visible, searching, matchIndex))}
        >
          <Text style={styles.action}>{L.copyLine}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="log-copy-match"
          onPress={() => emitCopy(copyMatchText(searching, matched))}
        >
          <Text style={styles.action}>{L.copyMatch}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="log-copy-all"
          onPress={() => emitCopy(copyAllText(entries))}
        >
          <Text style={styles.action}>{L.copyAll}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="A+"
          testID="log-font-up"
          onPress={() => setFontSize((value) => clampFontSize(value + 1))}
        >
          <Text style={[styles.action, fontSize >= LOG_FONT_MAX && styles.actionOff]}>A+</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="A-"
          testID="log-font-down"
          onPress={() => setFontSize((value) => clampFontSize(value - 1))}
        >
          <Text style={[styles.action, fontSize <= LOG_FONT_MIN && styles.actionOff]}>A-</Text>
        </Pressable>
        {onExport ? (
          <Pressable
            accessibilityRole="button"
            testID="log-export"
            onPress={() => onExport(exportLogText(entries))}
          >
            <Text style={styles.action}>{L.export}</Text>
          </Pressable>
        ) : null}
        {onClear ? (
          <Pressable accessibilityRole="button" testID="log-clear" onPress={onClear}>
            <Text style={styles.danger}>{L.clear}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          testID="log-latest"
          onPress={() => {
            setFollow(true);
            list.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={styles.action}>{L.latest}</Text>
        </Pressable>
      </View>
      </View>
      <FlatList
        ref={list}
        style={styles.pane}
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={`${fontSize}:${wrap}:${matchIndex}:${searching}`}
        contentContainerStyle={styles.inner}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        windowSize={7}
        removeClippedSubviews
        onScrollToIndexFailed={({ index }) => {
          requestAnimationFrame(() => list.current?.scrollToIndex({ index, animated: false }));
        }}
        ListEmptyComponent={
          <Text style={styles.empty} testID="log-empty">
            {emptyLabel}
          </Text>
        }
      />
    </KeyboardAvoidingView>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipOn]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const LogLine = memo(function LogLine({
  entry,
  fontSize,
  wrap,
  highlight,
  active,
  onCopy,
}: {
  entry: ApduLogEntry;
  fontSize: number;
  wrap: boolean;
  highlight: RegExp | null;
  active: boolean;
  onCopy: () => void;
}) {
  const hex = formatHex(entry.hex);
  const hexView = (
    <Text style={[styles.hex, { fontSize }, !wrap && styles.nowrap]} selectable>
      {paint(hex, highlight)}
    </Text>
  );
  return (
    <Pressable onPress={onCopy} style={[styles.line, active && styles.lineActive]}>
      <Text style={styles.gutter}>
        <Text style={styles.time}>{formatTime(entry.at)} </Text>
        <Text style={entry.direction === 'in' ? styles.rx : styles.tx}>
          {entry.direction === 'in' ? 'RX' : 'TX'}
        </Text>
        {entry.channel ? <Text style={styles.note}> [{entry.channel}]</Text> : null}
        {entry.note ? <Text style={styles.note}> {entry.note}</Text> : null}
      </Text>
      {wrap ? hexView : <ScrollView horizontal nestedScrollEnabled>{hexView}</ScrollView>}
    </Pressable>
  );
});

function paint(text: string, highlight: RegExp | null) {
  if (!highlight) {
    return text;
  }
  const pattern = new RegExp(highlight.source, highlight.flags.includes('g') ? highlight.flags : `${highlight.flags}g`);
  const parts: Array<{ value: string; hit: boolean }> = [];
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > last) {
      parts.push({ value: text.slice(last, match.index), hit: false });
    }
    parts.push({ value: match[0], hit: true });
    last = match.index + match[0].length;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }
    match = pattern.exec(text);
  }
  if (last < text.length) {
    parts.push({ value: text.slice(last), hit: false });
  }
  return parts.map((part, index) => (
    <Text key={index} style={part.hit ? styles.hit : undefined}>
      {part.value}
    </Text>
  ));
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    gap: space.sm,
  },
  instrument: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.sm,
    gap: space.sm,
    backgroundColor: colors.bgElevated,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  chip: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipOn: {
    borderColor: colors.ok,
    backgroundColor: colors.bg,
  },
  chipLabel: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  chipLabelOn: {
    color: colors.ok,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  search: {
    flex: 1,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.sm,
    minHeight: 36,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  count: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    minWidth: 48,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 2,
  },
  action: {
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
  },
  actionOff: {
    color: colors.muted,
  },
  danger: {
    color: colors.danger,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
  },
  pane: {
    flex: 1,
    minHeight: 0,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  inner: {
    padding: space.sm,
    gap: 4,
    flexGrow: 1,
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    padding: space.sm,
  },
  line: {
    gap: 4,
    paddingVertical: 2,
  },
  lineActive: {
    backgroundColor: colors.bgElevated,
  },
  gutter: {
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  time: {
    color: colors.muted,
  },
  rx: {
    color: colors.ok,
    fontFamily: fonts.monoBold,
  },
  tx: {
    color: colors.accent,
    fontFamily: fonts.monoBold,
  },
  note: {
    color: colors.muted,
  },
  hex: {
    color: colors.text,
    fontFamily: fonts.mono,
    lineHeight: 18,
  },
  nowrap: {
    flexShrink: 0,
  },
  hit: {
    backgroundColor: colors.accentDim,
    color: colors.ok,
  },
});
