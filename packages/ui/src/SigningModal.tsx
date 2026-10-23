import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { signingNeedsPassphrase, signingSlideLabel, type SigningRequest } from '@cws/contracts';
import { Button } from './Button';
import { SlideToConfirm } from './SlideToConfirm';
import { BRAND_LABEL, brandColor, colors, fonts, radius, space } from './theme';

type Props = {
  visible: boolean;
  request: SigningRequest | null;
  passphrase: string;
  onChangePassphrase: (value: string) => void;
  onConfirm: () => void;
  onReject: () => void;
};

export function SigningModal({
  visible,
  request,
  passphrase,
  onChangePassphrase,
  onConfirm,
  onReject,
}: Props) {
  const brand = request?.brand;
  const kind = request?.kind ?? 'sign';
  const showPassphrase = request ? signingNeedsPassphrase(kind) : false;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.kicker}>{request?.title ?? 'Confirm on device'}</Text>
          {brand ? (
            <Text style={[styles.brand, { color: brandColor(brand) }]}>{BRAND_LABEL[brand]}</Text>
          ) : null}
          <Text style={styles.path}>{request?.path ?? ''}</Text>
          <Text style={styles.message}>{request?.message ?? ''}</Text>
          {showPassphrase ? (
            <>
              <Text style={styles.hint}>BIP39 passphrase is never stored. Leave blank if unused.</Text>
              <TextInput
                value={passphrase}
                onChangeText={onChangePassphrase}
                placeholder="Optional passphrase"
                placeholderTextColor={colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="oneTimeCode"
                importantForAutofill="no"
                spellCheck={false}
                style={styles.input}
              />
            </>
          ) : null}
          <SlideToConfirm
            label={signingSlideLabel(kind)}
            onConfirm={onConfirm}
            resetKey={request ? `${request.kind}:${request.path}:${request.message}` : ''}
          />
          <View style={styles.actions}>
            <Button label="Reject" variant="danger" onPress={onReject} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
    padding: space.lg,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  kicker: {
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontSize: 12,
    fontWeight: '700',
  },
  brand: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  path: {
    color: colors.ok,
    fontFamily: fonts.mono,
    fontSize: 13,
  },
  message: {
    color: colors.text,
    lineHeight: 22,
    fontSize: 15,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  actions: {
    marginTop: space.sm,
    gap: space.sm,
  },
});
