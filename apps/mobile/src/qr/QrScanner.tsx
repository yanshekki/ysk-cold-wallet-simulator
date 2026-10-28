import { CameraView, useCameraPermissions } from 'expo-camera';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, colors, fonts, space } from '@cws/ui';

type Props = {
  visible: boolean;
  hint: string;
  progressLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  deniedLabel: string;
  allowLabel: string;
  closeLabel: string;
  onClose: () => void;
  onPart: (part: string) => void;
};

export function QrScanner({
  visible,
  hint,
  progressLabel,
  busy = false,
  busyLabel,
  deniedLabel,
  allowLabel,
  closeLabel,
  onClose,
  onPart,
}: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const granted = permission?.granted === true;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root} testID="device-qr-scanner">
        {granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (data) {
                onPart(data);
              }
            }}
          />
        ) : (
          <View style={styles.denied}>
            <Text style={styles.deniedText}>{deniedLabel}</Text>
            <Button label={allowLabel} onPress={() => void requestPermission()} />
          </View>
        )}
        <View style={[styles.top, { paddingTop: insets.top + space.md }]}>
          <Text style={styles.hint}>{hint}</Text>
          {progressLabel ? <Text style={styles.progress}>{progressLabel}</Text> : null}
          {busy ? (
            <View style={styles.busyRow} testID="device-qr-decoding">
              <ActivityIndicator color={colors.ok} />
              {busyLabel ? <Text style={styles.progress}>{busyLabel}</Text> : null}
            </View>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={[styles.close, { top: insets.top + space.sm }]}
          testID="device-qr-scanner-close"
        >
          <Text style={styles.closeLabel}>{closeLabel}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  denied: {
    flex: 1,
    justifyContent: 'center',
    padding: space.lg,
    gap: space.md,
  },
  deniedText: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  top: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    gap: space.sm,
  },
  hint: {
    color: '#ffffff',
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  progress: {
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 13,
    textAlign: 'center',
  },
  busyRow: {
    marginTop: space.sm,
    alignItems: 'center',
    gap: space.sm,
  },
  close: {
    position: 'absolute',
    right: space.md,
    padding: space.sm,
  },
  closeLabel: {
    color: '#ffffff',
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
});
