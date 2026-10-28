import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  HOLD_CONFIRM_DEFAULT_SECONDS,
  describeSigning,
  signingNeedsPassphrase,
  type SigningRequest,
} from '@cws/contracts';
import { Button } from './Button';
import { HoldToConfirm } from './HoldToConfirm';
import { SigningDetailView, type SigningCopy } from './SigningDetail';
import { BRAND_LABEL, brandColor, colors, fonts, hairline, radius, space } from './theme';

type Props = {
  visible: boolean;
  request: SigningRequest | null;
  onConfirm: () => void | Promise<void>;
  onReject: () => void;
  holdLabel?: string;
  rejectLabel?: string;
  confirmTitle?: string;
  holdDurationSeconds?: number;
  sessionPassphraseApplied?: boolean;
  passphraseAppliedLabel?: string;
  passphraseIdleLabel?: string;
  passphraseHostLabel?: string;
  verifyingLabel?: string;
  copy?: SigningCopy;
  /** Draw inside an already-presented modal. A second iOS Modal stays behind the first. */
  embedded?: boolean;
};

export function SigningModal({
  visible,
  request,
  onConfirm,
  onReject,
  holdLabel = 'Hold to sign',
  rejectLabel = 'Reject',
  confirmTitle = 'Confirm on device',
  holdDurationSeconds = HOLD_CONFIRM_DEFAULT_SECONDS,
  sessionPassphraseApplied = false,
  passphraseAppliedLabel = 'Passphrase on',
  passphraseIdleLabel = 'No passphrase',
  passphraseHostLabel = 'Host passphrase',
  verifyingLabel = 'Verifying…',
  copy,
  embedded = false,
}: Props) {
  const [verifying, setVerifying] = useState(false);
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

  useEffect(() => {
    if (!visible) {
      setVerifying(false);
    }
  }, [visible]);

  const handleConfirm = () => {
    if (verifying) {
      return;
    }
    setVerifying(true);
    void Promise.resolve(onConfirm()).finally(() => {
      setVerifying(false);
    });
  };

  if (embedded && !visible) {
    return null;
  }

  const sheet = (
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
            {verifying ? (
              <View style={styles.verifying} testID="signing-verifying">
                <ActivityIndicator color={colors.ok} />
                <Text style={styles.verifyingLabel}>{verifyingLabel}</Text>
              </View>
            ) : (
              <HoldToConfirm
                label={holdLabel}
                onConfirm={handleConfirm}
                resetKey={resetKey}
                durationSeconds={holdDurationSeconds}
              />
            )}
            <View style={styles.actions}>
              <Button
                testID="signing-reject"
                label={rejectLabel}
                variant="danger"
                onPress={onReject}
                disabled={verifying}
              />
            </View>
          </View>
        </View>
  );

  if (embedded) {
    return (
      <View style={styles.embeddedHost} testID="signing-embedded">
        {sheet}
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <GestureHandlerRootView style={styles.flex}>{sheet}</GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  embeddedHost: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
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
  verifying: {
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: hairline,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  verifyingLabel: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  actions: {
    marginTop: space.xs,
    gap: space.sm,
  },
});
