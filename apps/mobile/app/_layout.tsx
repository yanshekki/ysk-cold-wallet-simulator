import '../src/lab/polyfillCrypto';
import 'react-native-reanimated';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@cws/ui';
import { sessionRedirect } from '../src/passkeys';
import { AppStateProvider, useAppState } from '../src/state/AppState';

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

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AppStateProvider>
          <StatusBar style="light" />
          <SessionGate />
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
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
