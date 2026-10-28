import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { colors, fonts, hairline, radius, space } from './theme';

export type MnemonicGridLabels = {
  copy: string;
  copyTitle: string;
  copyBody: string;
  confirm: string;
  cancel: string;
};

type Props = {
  phrase: string;
  labels: MnemonicGridLabels;
};

export function MnemonicGrid({ phrase, labels }: Props) {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  const [refused, setRefused] = useState(false);
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {words.map((word, index) => (
          <View key={`${index}-${word}`} style={styles.cell}>
            <Text selectable={false} style={styles.index}>
              {index + 1}
            </Text>
            <Text selectable={false} style={styles.word}>
              {word}
            </Text>
          </View>
        ))}
      </View>
      <Button label={labels.copy} variant="ghost" onPress={() => setRefused(true)} />
      {refused ? (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text selectable={false} style={styles.noticeTitle}>
            {labels.copyTitle}
          </Text>
          <Text selectable={false} style={styles.noticeBody}>
            {labels.copyBody}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  cell: {
    width: '31%',
    flexGrow: 0,
    flexBasis: '31%',
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    gap: 2,
  },
  index: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  word: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 13,
  },
  notice: {
    gap: space.xs,
  },
  noticeTitle: {
    color: colors.danger,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  noticeBody: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
});
