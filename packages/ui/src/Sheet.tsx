import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  closeIcon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
};

export function Sheet({
  visible,
  title,
  onClose,
  closeLabel = 'Close',
  closeIcon,
  children,
  footer,
  testID,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.frame}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
          testID={testID}
        >
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              testID="sheet-close"
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              {closeIcon ?? <Text style={styles.closeGlyph}>{'\u00D7'}</Text>}
            </Pressable>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: space.lg,
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
    maxHeight: '80%',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 18,
    letterSpacing: 0.2,
  },
  close: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '300',
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    gap: space.md,
    paddingBottom: space.sm,
  },
  footer: {
    gap: space.sm,
  },
});
