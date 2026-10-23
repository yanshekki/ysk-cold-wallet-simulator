import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Screen, colors, space } from '@cws/ui';
import { useAppState } from '../src/state/AppState';

export default function HomeScreen() {
  const router = useRouter();
  const { unlockedUntil, unlock, lock, model, seed, advertising, error } = useAppState();
  const unlocked = !!unlockedUntil && unlockedUntil > Date.now();

  return (
    <Screen
      title={unlocked ? 'Ready to simulate' : 'Unlock'}
      subtitle={
        unlocked
          ? 'Android first. Keep the app in the foreground — iOS background BLE is limited.'
          : 'Biometric / device PIN unlocks a 15-minute session. Seeds stay in SecureStore.'
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.card}>
        <Text style={styles.meta}>Model</Text>
        <Text style={styles.value}>{model?.name ?? 'None selected'}</Text>
        <Text style={styles.meta}>Seed</Text>
        <Text style={styles.value}>{seed?.label ?? 'None selected'}</Text>
        <Text style={styles.meta}>Advertising</Text>
        <Text style={styles.value}>{advertising ? 'On' : 'Off'}</Text>
      </View>
      {!unlocked ? (
        <Button label="Unlock" onPress={() => void unlock()} />
      ) : (
        <>
          <Button label="Choose model" onPress={() => router.push('/models')} />
          <Button label="Seed vault" variant="ghost" onPress={() => router.push('/seeds')} />
          <Button label="Start simulation" variant="ghost" onPress={() => router.push('/simulate')} />
          <Button label="Lock" variant="danger" onPress={lock} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: space.md,
    gap: 6,
    marginBottom: space.sm,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 6,
  },
  value: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
  },
});
