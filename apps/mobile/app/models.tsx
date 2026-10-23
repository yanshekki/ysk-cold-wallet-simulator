import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { ALL_MODELS } from '@cws/contracts';
import { BrandGrid, Screen, colors } from '@cws/ui';
import { useAppState } from '../src/state/AppState';

export default function ModelsScreen() {
  const router = useRouter();
  const { model, selectModel } = useAppState();

  return (
    <Screen
      title="Brand & model"
      subtitle="This slice advertises Ledger Nano X only. Other models are listed so the catalog matches the architecture."
    >
      <Text style={styles.copy}>
        Hosts scan for the exact Service UUID and local name of a real Nano X.
      </Text>
      <BrandGrid
        selectedId={model?.id}
        onSelect={(next) => {
          selectModel(next);
          router.back();
        }}
        items={ALL_MODELS.map((item) => ({
          model: item,
          enabled: item.id === 'nano-x',
          badge:
            item.id === 'nano-x'
              ? 'BLE ready'
              : item.brand === 'ledger'
                ? 'UUID catalogued'
                : 'Next phase',
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
