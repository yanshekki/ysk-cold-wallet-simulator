import { Dimensions, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { describeSigning, signingNeedsPassphrase, type SigningRequest } from '@cws/contracts';
import { Button } from './Button';
import { SigningDetailView, type SigningCopy } from './SigningDetail';
import { SlideToConfirm } from './SlideToConfirm';
import { BRAND_LABEL, brandColor, colors, fonts, hairline, radius, space } from './theme';

type Props = {
  visible: boolean;
  request: SigningRequest | null;
  onConfirm: () => void;
  onReject: () => void;
  slideLabel?: string;
  rejectLabel?: string;
  confirmTitle?: string;
  sessionPassphraseApplied?: boolean;
  passphraseAppliedLabel?: string;
  passphraseIdleLabel?: string;
  passphraseHostLabel?: string;
  copy?: SigningCopy;
};

export function SigningModal({
  visible,
  request,
  onConfirm,
  onReject,
  slideLabel = 'Slide to sign',
  rejectLabel = 'Reject',
  confirmTitle = 'Confirm on device',
  sessionPassphraseApplied = false,
  passphraseAppliedLabel = 'Passphrase on',
  passphraseIdleLabel = 'No passphrase',
  passphraseHostLabel = 'Host passphrase',
  copy,
}: Props) {
  const brand = request?.brand;
  const kind = request?.kind ?? 'sign';
  const sheetMax = Math.round(Dimensions.get('window').height * 0.8);
  const previewMax = Math.round(Dimensions.get('window').height * 0.42);
  const showChip = request ? signingNeedsPassphrase(kind) : false;
  const source = request?.passphraseSource;
  const chipOn = source === 'host' || source === 'device' || sessionPassphraseApplied;
  const chipLabel =
    source === 'host' ? passphraseHostLabel : chipOn ? passphraseAppliedLabel : passphraseIdleLabel;
  const resetKey = request
    ? `${request.kind}:${request.path}:${request.title}:${describeSigning(request).headline}`
    : '';
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { maxHeight: sheetMax }]}>
            <Text style={styles.kicker}>{request?.title ?? confirmTitle}</Text>
            {brand ? (
              <Text style={[styles.brand, { color: brandColor(brand) }]}>{BRAND_LABEL[brand]}</Text>
            ) : null}
            {request ? (
              <ScrollView
                style={[styles.preview, { maxHeight: previewMax }]}
                contentContainerStyle={styles.previewInner}
                nestedScrollEnabled
              >
                <SigningDetailView request={request} copy={copy} />
              </ScrollView>
            ) : null}
            {showChip ? (
              <Text style={chipOn ? styles.chipOn : styles.chipOff}>{chipLabel}</Text>
            ) : null}
            <SlideToConfirm label={slideLabel} onConfirm={onConfirm} resetKey={resetKey} />
            <View style={styles.actions}>
              <Button testID="signing-reject" label={rejectLabel} variant="danger" onPress={onReject} />
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
    padding: space.lg,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  kicker: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 10,
  },
  brand: {
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  preview: {
    flexGrow: 0,
  },
  previewInner: {
    gap: space.sm,
    paddingBottom: space.xs,
  },
  chipOn: {
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  chipOff: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  actions: {
    marginTop: space.xs,
    gap: space.sm,
  },
});
