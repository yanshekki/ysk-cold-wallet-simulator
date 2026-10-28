import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button, colors, fonts, hairline, radius, space } from '@cws/ui';
import { bleHostLabel } from '../ble/bleSignGate';
import { useT } from '../i18n';

type Props = {
  centralId: string | null;
  onAllow: () => void;
  onReject: () => void;
};

export function BleHostSheet({ centralId, onAllow, onReject }: Props) {
  const t = useT();
  const label = centralId ? bleHostLabel(centralId) : '';
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="ble-host-sheet">
          <Text style={styles.kicker}>{t('signing.bleHostTitle')}</Text>
          {label ? <Text style={styles.id}>{t('signing.bleHostId', { id: label })}</Text> : null}
          <Text style={styles.body}>{t('signing.bleHostBody')}</Text>
          <Button testID="ble-host-allow" label={t('signing.bleHostAllow')} onPress={onAllow} />
          <Button testID="ble-host-reject" label={t('signing.bleHostReject')} variant="danger" onPress={onReject} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
    padding: space.lg,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  kicker: {
    color: colors.danger,
    fontFamily: fonts.sansSemi,
    fontSize: 18,
  },
  id: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 13,
  },
  body: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
});
