import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, colors, fonts, space } from '@cws/ui';
import { shouldMountCameraPreview, shouldPromptCameraPermission } from './cameraPreview';

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
  const statusKnown = permission != null;
  const [presented, setPresented] = useState(false);
  const mountPreview = shouldMountCameraPreview({ visible, granted, presented });

  useEffect(() => {
    if (!visible) {
      setPresented(false);
    }
  }, [visible]);

  useEffect(() => {
    if (
      shouldPromptCameraPermission({
        visible,
        granted,
        canAskAgain: permission?.canAskAgain !== false,
        statusKnown,
      })
    ) {
      void requestPermission();
    }
  }, [visible, granted, permission?.canAskAgain, requestPermission, statusKnown]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onShow={() => setPresented(true)}
      onDismiss={() => setPresented(false)}
      onRequestClose={onClose}
    >
      <View style={styles.root} testID="device-qr-scanner" collapsable={false}>
        {mountPreview ? (
          <CameraView
            key={`preview-${presented ? 'on' : 'off'}`}
            style={styles.preview}
            facing="back"
            active
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (data) {
                onPart(data);
              }
            }}
          />
        ) : granted ? (
          <View style={styles.waiting} testID="device-qr-scanner-waiting">
            <ActivityIndicator color={colors.ok} />
          </View>
        ) : (
          <View style={styles.denied}>
            {statusKnown ? (
              <>
                <Text style={styles.deniedText}>{deniedLabel}</Text>
                <Button label={allowLabel} onPress={() => void requestPermission()} />
              </>
            ) : (
              <ActivityIndicator color={colors.ok} />
            )}
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
  preview: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#000000',
  },
  waiting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
