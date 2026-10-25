import { Stack } from 'expo-router';
import { colors } from '@cws/ui';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="language" />
      <Stack.Screen name="security" />
      <Stack.Screen name="accounts" />
      <Stack.Screen name="catalog" />
      <Stack.Screen name="paths" />
      <Stack.Screen name="data" />
    </Stack>
  );
}
