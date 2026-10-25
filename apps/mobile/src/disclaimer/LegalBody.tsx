import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, space } from '@cws/ui';
import { useT } from '../i18n';

export function LegalBody({ sections }: { sections: readonly (readonly [string, string])[] }) {
  const t = useT();
  return (
    <View style={styles.wrap}>
      {sections.map(([title, body]) => (
        <View key={title} style={styles.section}>
          <Text style={styles.heading}>{t(title)}</Text>
          <Text style={styles.body}>{t(body)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.lg,
  },
  section: {
    gap: space.sm,
  },
  heading: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  body: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
  },
});
