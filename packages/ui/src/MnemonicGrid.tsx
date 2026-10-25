import { Alert, StyleSheet, Text, View } from 'react-native';
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
  onCopy: (text: string) => void;
};

export function MnemonicGrid({ phrase, labels, onCopy }: Props) {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {words.map((word, index) => (
          <View key={`${index}-${word}`} style={styles.cell}>
            <Text style={styles.index}>{index + 1}</Text>
            <Text style={styles.word} selectable>
              {word}
            </Text>
          </View>
        ))}
      </View>
      <Button
        label={labels.copy}
        variant="ghost"
        onPress={() => {
          Alert.alert(labels.copyTitle, labels.copyBody, [
            { text: labels.cancel, style: 'cancel' },
            { text: labels.confirm, onPress: () => onCopy(phrase) },
          ]);
        }}
      />
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
});
