import '../src/lab/polyfillCrypto';
import 'react-native-reanimated';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@cws/ui';
import { AppStateProvider, useAppState } from '../src/state/AppState';

function SessionGate() {
  const { unlockedUntil } = useAppState();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const unlocked = !!unlockedUntil && unlockedUntil > Date.now();
    if (!unlocked && pathname !== '/') {
      router.replace('/');
      return;
    }
    if (unlocked && pathname === '/') {
      router.replace('/(app)');
    }
  }, [pathname, router, unlockedUntil]);

  return null;
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
            <Stack.Screen name="(app)" />
            <Stack.Screen name="seeds/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="seeds/import" options={{ presentation: 'modal' }} />
          </Stack>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
