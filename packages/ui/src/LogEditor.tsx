import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ApduLogEntry } from '@cws/contracts';
import { entryHaystack, formatHex, formatLogText, formatTime } from './logFormat';
import { colors, fonts, radius, space } from './theme';

type Filter = 'all' | 'in' | 'out';

type Props = {
  entries: ApduLogEntry[];
  emptyLabel?: string;
  onCopy: (text: string) => void;
  onClear?: () => void;
  onExport?: (text: string) => void;
};

function buildMatcher(
  query: string,
  caseSensitive: boolean,
  regex: boolean,
): { test: (text: string) => boolean; source: string | null; flags: string; error: string | null } {
  if (!query) {
    return { test: () => true, source: null, flags: 'g', error: null };
  }
  try {
    const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'g' : 'gi';
    return {
      test: (text) => new RegExp(source, flags).test(text),
      source,
      flags,
      error: null,
    };
  } catch {
    return { test: () => false, source: null, flags: 'g', error: 'Invalid regex' };
  }
}

export function LogEditor({
  entries,
  emptyLabel = 'Waiting for host… advertise from Device.',
  onCopy,
  onClear,
  onExport,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const [fontSize, setFontSize] = useState(12);
  const [matchIndex, setMatchIndex] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const yMap = useRef<Record<string, number>>({});

  const filtered = useMemo(() => {
    if (filter === 'all') {
      return entries;
    }
    return entries.filter((entry) => entry.direction === filter);
  }, [entries, filter]);

  const matcher = useMemo(
    () => buildMatcher(query, caseSensitive, regex),
    [caseSensitive, query, regex],
  );

  const matched = useMemo(() => {
    if (!query || matcher.error) {
      return filtered;
    }
    return filtered.filter((entry) => matcher.test(entryHaystack(entry)));
  }, [filtered, matcher, query]);

  const searching = Boolean(query) && !matcher.error;
  const visible = searching ? matched : filtered;
  const matchCount = searching ? matched.length : 0;

  const goPrev = () => {
    if (matchCount === 0) {
      return;
    }
    setFollow(false);
    setMatchIndex((index) => (index - 1 + matchCount) % matchCount);
  };

  const goNext = () => {
    if (matchCount === 0) {
      return;
    }
    setFollow(false);
    setMatchIndex((index) => (index + 1) % matchCount);
  };

  useEffect(() => {
    if (matchIndex >= matchCount) {
      setMatchIndex(0);
    }
  }, [matchCount, matchIndex]);

  useEffect(() => {
    if (searching) {
      const id = visible[matchIndex]?.id;
      const y = id ? yMap.current[id] : undefined;
      if (typeof y === 'number') {
        scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
      }
      return;
    }
    if (follow) {
      requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
    }
  }, [follow, matchIndex, searching, visible]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
    if (!atBottom && follow) {
      setFollow(false);
    }
  };

  const dump = formatLogText(visible);
  const highlight = matcher.source ? new RegExp(matcher.source, matcher.flags) : null;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.chips}>
          <Chip label="ALL" active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="RX" active={filter === 'in'} onPress={() => setFilter('in')} />
          <Chip label="TX" active={filter === 'out'} onPress={() => setFilter('out')} />
        </View>
        <View style={styles.chips}>
          <Chip label="WRAP" active={wrap} onPress={() => setWrap((value) => !value)} />
          <Chip label="FOLLOW" active={follow} onPress={() => setFollow((value) => !value)} />
        </View>
      </View>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setMatchIndex(0);
            setFollow(false);
          }}
          placeholder="Search"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          blurOnSubmit={false}
          returnKeyType="search"
          style={styles.search}
          onSubmitEditing={goNext}
          onKeyPress={(event) => {
            if (event.nativeEvent.key !== 'Enter') {
              return;
            }
            const shift = Boolean((event.nativeEvent as { shiftKey?: boolean }).shiftKey);
            if (shift) {
              goPrev();
            } else {
              goNext();
            }
          }}
        />
        <Text style={styles.count}>{matcher.error ?? `${matchCount ? matchIndex + 1 : 0}/${matchCount}`}</Text>
        <Chip label="Aa" active={caseSensitive} onPress={() => setCaseSensitive((value) => !value)} />
        <Chip label=".*" active={regex} onPress={() => setRegex((value) => !value)} />
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={goPrev}>
          <Text style={styles.action}>Prev</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={goNext}>
          <Text style={styles.action}>Next</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const line = visible[searching ? matchIndex : visible.length - 1];
            if (line) {
              onCopy(formatHex(line.hex));
            }
          }}
        >
          <Text style={styles.action}>Copy line</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onCopy(searching ? formatLogText(matched) : dump)}>
          <Text style={styles.action}>Copy match</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onCopy(dump)}>
          <Text style={styles.action}>Copy all</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setFontSize((value) => Math.min(16, value + 1))}>
          <Text style={styles.action}>A+</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setFontSize((value) => Math.max(10, value - 1))}>
          <Text style={styles.action}>A-</Text>
        </Pressable>
        {onExport ? (
          <Pressable accessibilityRole="button" onPress={() => onExport(dump)}>
            <Text style={styles.action}>Export</Text>
          </Pressable>
        ) : null}
        {onClear ? (
          <Pressable accessibilityRole="button" onPress={onClear}>
            <Text style={styles.danger}>Clear</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setFollow(true);
            scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={styles.action}>Latest</Text>
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        style={styles.pane}
        contentContainerStyle={styles.inner}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {visible.length === 0 ? (
          <Text style={styles.empty}>{emptyLabel}</Text>
        ) : (
          visible.map((entry, index) => (
            <LogLine
              key={entry.id}
              entry={entry}
              fontSize={fontSize}
              wrap={wrap}
              highlight={highlight}
              active={searching && index === matchIndex}
              onLayoutY={(y) => {
                yMap.current[entry.id] = y;
              }}
              onCopy={() => onCopy(formatHex(entry.hex))}
            />
          ))
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

function LogLine({
  entry,
  fontSize,
  wrap,
  highlight,
  active,
  onLayoutY,
  onCopy,
}: {
  entry: ApduLogEntry;
  fontSize: number;
  wrap: boolean;
  highlight: RegExp | null;
  active: boolean;
  onLayoutY: (y: number) => void;
  onCopy: () => void;
}) {
  const hex = formatHex(entry.hex);
  const hexView = (
    <Text style={[styles.hex, { fontSize }, !wrap && styles.nowrap]} selectable>
      {paint(hex, highlight)}
    </Text>
  );
  return (
    <Pressable
      onPress={onCopy}
      onLayout={(event) => onLayoutY(event.nativeEvent.layout.y)}
      style={[styles.line, active && styles.lineActive]}
    >
      <Text style={styles.gutter}>
        <Text style={styles.time}>{formatTime(entry.at)} </Text>
        <Text style={entry.direction === 'in' ? styles.rx : styles.tx}>
          {entry.direction === 'in' ? 'RX' : 'TX'}
        </Text>
        {entry.note ? <Text style={styles.note}> {entry.note}</Text> : null}
      </Text>
      {wrap ? hexView : <ScrollView horizontal nestedScrollEnabled>{hexView}</ScrollView>}
    </Pressable>
  );
}

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
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.sm,
    minHeight: 40,
    fontFamily: fonts.mono,
    fontSize: 13,
  },
  count: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    minWidth: 48,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  action: {
    color: colors.ok,
    fontSize: 12,
    fontWeight: '700',
  },
  danger: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  pane: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
  },
  inner: {
    padding: space.sm,
    gap: 10,
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  line: {
    gap: 4,
    paddingVertical: 4,
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
    fontWeight: '700',
  },
  tx: {
    color: colors.accent,
    fontWeight: '700',
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
