import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  phrase: string;
};

export function MnemonicGrid({ phrase }: Props) {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  return (
    <View style={styles.grid}>
      {words.map((word, index) => (
        <View
          key={`${index}-${word}`}
          accessible
          accessibilityLabel={`Recovery word ${index + 1}`}
          style={styles.cell}
        >
          <Text selectable={false} importantForAccessibility="no" style={styles.index}>
            {index + 1}
          </Text>
          <Text selectable={false} importantForAccessibility="no" style={styles.word}>
            {word}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
