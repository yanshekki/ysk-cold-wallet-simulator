import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, hairline, radius, space } from './theme';

export function Toast({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.pill}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
  },
  pill: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.ok,
    borderWidth: hairline,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  text: {
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    letterSpacing: 0.6,
  },
});
