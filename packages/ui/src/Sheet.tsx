import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from './keyboard';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  closeIcon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Rendered above the sheet inside the same Modal (avoids nested Modal on iOS). */
  overlay?: ReactNode;
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
  overlay,
  testID,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.frame}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <View
          style={styles.sheet}
          testID={testID}
          // Keep sheet touches from falling through to the backdrop Pressable on iOS.
          onStartShouldSetResponder={() => true}
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
              {closeIcon ?? <Text style={styles.closeGlyph}>{'×'}</Text>}
            </Pressable>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
        {overlay}
      </KeyboardAvoidingView>
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
