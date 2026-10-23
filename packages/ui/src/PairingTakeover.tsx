import { useEffect, useRef } from 'react';
import { Animated, Modal, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, motion, space } from './theme';

type Props = {
  code: string | null;
};

export function PairingTakeover({ code }: Props) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!code) {
      scale.setValue(0.92);
      opacity.setValue(0);
      return;
    }
    scale.setValue(0.92);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 1,
        duration: motion.sheet,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.sheet,
        useNativeDriver: true,
      }),
    ]).start();
  }, [code, opacity, scale]);

  return (
    <Modal visible={!!code} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Animated.View style={[styles.panel, { opacity, transform: [{ scale }] }]}>
          <Text style={styles.kicker}>Type this on the host</Text>
          <Text style={styles.code}>{code ?? ''}</Text>
          <Text style={styles.hint}>Pairing holds until the host confirms. This screen does not loop the digits.</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  panel: {
    alignItems: 'center',
    gap: space.md,
  },
  kicker: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  code: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: 10,
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
});
