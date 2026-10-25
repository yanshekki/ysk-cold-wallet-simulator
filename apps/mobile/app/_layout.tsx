import '../src/lab/polyfillCrypto';
import 'react-native-reanimated';
import { useEffect } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootSplash, LoadingOverlay, colors } from '@cws/ui';
import { useT } from '../src/i18n';
import { sessionRedirect } from '../src/passkeys';
import { releaseCaptureOverlay } from '../src/seeds/screenGuard';
import { AppStateProvider, useAppState } from '../src/state/AppState';
import { useAppFonts } from '../src/ui/loadFonts';

export { ErrorBoundary } from 'expo-router';

function SessionGate() {
  const { unlockedUntil } = useAppState();
  const segments = useSegments();
  const unlocked = !!unlockedUntil && unlockedUntil > Date.now();
  const href = sessionRedirect(unlocked, segments[0]);
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
  const { hydrated } = useAppState();
  const t = useT();
  if (!fontsReady || !hydrated) {
    return (
      <BootSplash
        label={t('common.loading')}
        version={Constants.expoConfig?.version ?? '1.0.0'}
      />
    );
  }
  return (
    <>
      <SessionGate />
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" />
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
      <SafeAreaProvider style={{ flex: 1 }}>
        <AppStateProvider>
          <StatusBar style="light" />
          <BootGate fontsReady={fontsReady} />
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
