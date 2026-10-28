import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, colors, fonts, space } from '@cws/ui';
import {
  cameraPreviewKey,
  cameraSettleMs,
  cameraSettleReason,
  isCameraAppActive,
  nextCameraGeneration,
  shouldMountCameraPreview,
  shouldPromptCameraPermission,
  shouldRemountAfterFailure,
  shouldRunCameraSession,
} from './cameraPreview';

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
  const [appPhase, setAppPhase] = useState(() => AppState.currentState);
  const [settled, setSettled] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const remountsRef = useRef(0);
  const appActiveRef = useRef(isCameraAppActive(AppState.currentState));
  const retryNonceRef = useRef(0);
  const appActive = isCameraAppActive(appPhase);
  const mountPreview = shouldMountCameraPreview({
    visible,
    granted,
    presented,
    appActive,
    settled,
  });

  useEffect(() => {
    setAppPhase(AppState.currentState);
    const sub = AppState.addEventListener('change', (next) => {
      setAppPhase(next);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!visible) {
      setPresented(false);
      setSettled(false);
      remountsRef.current = 0;
      setRetryNonce(0);
    }
  }, [visible]);

  useEffect(() => {
    if (visible && presented) {
      setGeneration((current) => nextCameraGeneration(current, 'presented'));
      remountsRef.current = 0;
      setRetryNonce(0);
    }
  }, [visible, presented]);

  useEffect(() => {
    const becameAppActive = appActive && !appActiveRef.current;
    appActiveRef.current = appActive;
    const isRetry = retryNonce !== retryNonceRef.current;
    retryNonceRef.current = retryNonce;

    if (!visible || !presented || !appActive) {
      setSettled(false);
      return;
    }

    if (becameAppActive) {
      setGeneration((current) => nextCameraGeneration(current, 'app-focus'));
      remountsRef.current = 0;
    }

    const reason = cameraSettleReason({ presented: true, becameAppActive, isRetry });
    const timer = setTimeout(() => setSettled(true), cameraSettleMs(reason ?? 'present'));
    return () => {
      clearTimeout(timer);
      setSettled(false);
    };
  }, [visible, presented, appActive, retryNonce]);

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
            key={cameraPreviewKey(generation)}
            style={styles.preview}
            facing="back"
            active={shouldRunCameraSession({ appActive })}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onMountError={() => {
              if (!shouldRemountAfterFailure({ remountsThisPresentation: remountsRef.current })) {
                return;
              }
              remountsRef.current += 1;
              setGeneration((current) => nextCameraGeneration(current, 'mount-error'));
              setRetryNonce((nonce) => nonce + 1);
            }}
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
