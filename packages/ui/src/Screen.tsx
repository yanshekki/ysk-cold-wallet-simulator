import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from './keyboard';
import { colors, fonts, hairline, space, typography } from './theme';

type Props = {
  title: string;
  subtitle?: string;
  kicker?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  onBack?: () => void;
  backLabel?: string;
  backIcon?: ReactNode;
};

export function Screen({
  title,
  subtitle,
  kicker = 'YSK',
  children,
  footer,
  scroll = true,
  edges = ['top', 'bottom'],
  onBack,
  backLabel = 'Back',
  backIcon,
}: Props) {
  const body = (
    <View style={[styles.body, !scroll && styles.bodyFill]}>
      {kicker && !onBack ? <Text style={styles.kicker}>{`/ ${kicker}`}</Text> : null}
      <View style={styles.titleRow}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            testID="screen-back"
            onPress={onBack}
            hitSlop={8}
            style={styles.back}
          >
            {backIcon ?? <Text style={styles.backGlyph}>{'\u2039'}</Text>}
          </Pressable>
        ) : null}
        <Text
          style={[styles.title, !kicker && !onBack && styles.titleHero, onBack && styles.titleWithBack]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={[styles.content, !scroll && styles.contentFill]}>{children}</View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {scroll ? (
        <KeyboardAwareScrollView
          style={styles.fill}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          {body}
        </KeyboardAwareScrollView>
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
  fill: {
    flex: 1,
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
    ...typography.kicker,
    marginBottom: space.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
  },
  back: {
    width: 32,
    height: 36,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '300',
  },
  title: {
    ...typography.title,
    flex: 1,
  },
  titleWithBack: {
    fontSize: 18,
  },
  titleHero: {
    fontFamily: fonts.sansSemi,
    fontSize: 28,
    letterSpacing: 1,
    color: colors.text,
  },
  subtitle: {
    ...typography.meta,
    marginTop: space.xs,
  },
  content: {
    marginTop: space.md,
    gap: space.md,
  },
  contentFill: {
    flex: 1,
    minHeight: 0,
  },
  footer: {
    padding: space.md,
    paddingBottom: space.lg,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
});
