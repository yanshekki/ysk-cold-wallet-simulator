import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { ALL_MODELS } from '@cws/contracts';
import { isSimulatable } from '@cws/sdk';
import { BrandGrid, Screen, colors } from '@cws/ui';
import { useAppState } from '../src/state/AppState';

export default function ModelsScreen() {
  const router = useRouter();
  const { model, selectModel } = useAppState();

  return (
    <Screen
      title="Brand & model"
      subtitle="This phase advertises every Ledger BLE model, OneKey Classic / Touch / Pro, and Trezor Safe 7. OneKey Pro 2 and Neo stay listed for the next protocol phase."
    >
      <Text style={styles.copy}>
        Hosts scan for the exact Service UUID and local name of the selected device. Transport
        answers are real; attestation is not faked.
      </Text>
      <BrandGrid
        selectedId={model?.id}
        onSelect={(next) => {
          selectModel(next);
          router.back();
        }}
        items={ALL_MODELS.map((item) => ({
          model: item,
          enabled: isSimulatable(item),
          badge: isSimulatable(item) ? 'BLE ready' : 'Next phase',
        }))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: colors.muted,
    lineHeight: 22,
  },
});
