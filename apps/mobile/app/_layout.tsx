import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppStateProvider, useAppState } from '../src/state/AppState';
import { colors } from '@cws/ui';

function SessionGate() {
  const { unlockedUntil } = useAppState();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const unlocked = !!unlockedUntil && unlockedUntil > Date.now();
    if (!unlocked && pathname !== '/') {
      router.replace('/');
    }
  }, [pathname, router, unlockedUntil]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppStateProvider>
        <StatusBar style="light" />
        <SessionGate />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="models" options={{ title: 'Brand & model' }} />
          <Stack.Screen name="seeds/index" options={{ title: 'Seed vault' }} />
          <Stack.Screen name="seeds/new" options={{ title: 'Generate seed' }} />
          <Stack.Screen name="seeds/import" options={{ title: 'Import seed' }} />
          <Stack.Screen name="simulate" options={{ title: 'Simulation' }} />
        </Stack>
      </AppStateProvider>
    </GestureHandlerRootView>
  );
}
