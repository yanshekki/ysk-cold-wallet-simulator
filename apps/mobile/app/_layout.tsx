import '../src/lab/polyfillCrypto';
import 'react-native-reanimated';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootSplash, KeyboardProvider, LoadingOverlay, colors } from '@cws/ui';
import { isRtl, useT } from '../src/i18n';
import { sessionRedirect } from '../src/passkeys';
import { releaseCaptureOverlay } from '../src/seeds/screenGuard';
import { AppStateProvider, useAppState } from '../src/state/AppState';
import { useAppFonts } from '../src/ui/loadFonts';

export { ErrorBoundary } from 'expo-router';

function SessionGate() {
  const { unlockedUntil, disclaimerAccepted } = useAppState();
  const segments = useSegments();
  const unlocked = !!unlockedUntil && unlockedUntil > Date.now();
  const href = sessionRedirect(unlocked, segments[0], disclaimerAccepted);
  if (!href) {
    return null;
  }
  return <Redirect href={href} />;
}

function LoadingHost() {
  const { loading } = useAppState();
  const t = useT();
  return <LoadingOverlay visible={!!loading} label={loading ?? t('common.loading')} />;
}

function BootGate({ fontsReady }: { fontsReady: boolean }) {
  const { hydrated, settings } = useAppState();
  const t = useT();
  const frame = isRtl(settings.language) ? ({ flex: 1, direction: 'rtl' } as const) : styles.frame;
  if (!fontsReady || !hydrated) {
    return (
      <View style={frame}>
        <BootSplash
          label={t('common.loading')}
          version={Constants.expoConfig?.version ?? '1.1.2'}
        />
      </View>
    );
  }
  return (
    <>
      <SessionGate />
      <View style={frame}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: styles.stack,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="disclaimer" />
          <Stack.Screen name="unlock" />
          <Stack.Screen name="(app)" />
          <Stack.Screen name="seeds/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="seeds/import" options={{ presentation: 'modal' }} />
        </Stack>
        <LoadingHost />
      </View>
    </>
  );
}

export default function RootLayout() {
  const fontsReady = useAppFonts();
  useEffect(() => {
    releaseCaptureOverlay();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardProvider preload={false}>
        <SafeAreaProvider style={{ flex: 1 }}>
          <AppStateProvider>
            <StatusBar style="light" />
            <BootGate fontsReady={fontsReady} />
          </AppStateProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
  stack: {
    backgroundColor: colors.bg,
    paddingLeft: 0,
    paddingRight: 0,
  },
});
