import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type ViewStyle,
} from 'react-native';

type ProviderProps = {
  children: ReactNode;
  statusBarTranslucent?: boolean;
  navigationBarTranslucent?: boolean;
};

type AwareProps = ScrollViewProps & {
  bottomOffset?: number;
  children?: ReactNode;
};

type StickyProps = {
  children?: ReactNode;
  offset?: { closed?: number; opened?: number };
  style?: ViewStyle;
};

export function KeyboardProvider({ children }: ProviderProps) {
  return children;
}

export function KeyboardAwareScrollView({ bottomOffset, style, ...rest }: AwareProps) {
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={typeof bottomOffset === 'number' ? bottomOffset : 0}
    >
      <ScrollView style={[styles.fill, style]} keyboardShouldPersistTaps="handled" {...rest} />
    </KeyboardAvoidingView>
  );
}

export function KeyboardStickyView({ children, style }: StickyProps) {
  return <View style={style}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
