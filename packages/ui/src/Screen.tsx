import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, space } from './theme';

type Props = {
  title: string;
  subtitle?: string;
  kicker?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
};

export function Screen({
  title,
  subtitle,
  kicker = 'YSK',
  children,
  footer,
  scroll = true,
  edges = ['top', 'bottom'],
}: Props) {
  const body = (
    <View style={[styles.body, !scroll && styles.bodyFill]}>
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={[styles.title, !kicker && styles.titleHero]}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={[styles.content, !scroll && styles.contentFill]}>{children}</View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        body
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    paddingBottom: 48,
  },
  body: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  bodyFill: {
    flex: 1,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  titleHero: {
    fontSize: 56,
    letterSpacing: 2,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: space.sm,
  },
  content: {
    marginTop: space.lg,
    gap: space.md,
  },
  contentFill: {
    flex: 1,
    minHeight: 0,
  },
  footer: {
    padding: space.md,
    paddingBottom: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
});
