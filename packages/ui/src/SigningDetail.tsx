import { StyleSheet, Text, View } from 'react-native';
import { describeSigning, type SigningDetail, type SigningRequest } from '@cws/contracts';
import { formatHex } from './logFormat';
import { colors, fonts, space } from './theme';

export type SigningCopy = {
  decodeFailed?: string;
  personalMessage?: string;
  rawMessage?: string;
  noticeOpenApp?: string;
  noticeManager?: string;
  noticePairing?: string;
  noticeVerify?: string;
};

type Props = {
  request: SigningRequest;
  copy?: SigningCopy;
};

function localize(detail: SigningDetail, request: SigningRequest, copy?: SigningCopy): SigningDetail {
  let headline = detail.headline;
  let warning = detail.warning;
  if (detail.decodeFailed && copy?.decodeFailed) {
    headline = copy.decodeFailed;
  }
  if (detail.style === 'eth-message') {
    if (detail.hex && copy?.rawMessage) {
      headline = copy.rawMessage;
    } else if (!detail.hex && copy?.personalMessage) {
      headline = copy.personalMessage;
    }
  }
  if (request.kind === 'open-app' && copy?.noticeOpenApp) {
    warning = copy.noticeOpenApp;
  } else if (request.kind === 'allow-manager' && copy?.noticeManager) {
    warning = copy.noticeManager;
  } else if (request.kind === 'pairing' && copy?.noticePairing) {
    warning = copy.noticePairing;
  } else if (request.kind === 'verify' && copy?.noticeVerify) {
    warning = copy.noticeVerify;
  }
  return { ...detail, headline, warning };
}

export function SigningDetailView({ request, copy }: Props) {
  const detail = localize(describeSigning(request), request, copy);
  return (
    <View style={styles.box}>
      <Text style={styles.headline}>{detail.headline}</Text>
      {detail.warning ? <Text style={styles.warning}>{detail.warning}</Text> : null}
      {detail.note ? <Text style={styles.note}>{detail.note}</Text> : null}
      {detail.fields.map((field) => (
        <View key={`${field.label}:${field.value.slice(0, 24)}`} style={styles.row}>
          <Text style={styles.label}>{field.label}</Text>
          <Text style={field.mono ? styles.mono : styles.value} selectable>
            {field.value}
          </Text>
        </View>
      ))}
      {detail.hex ? (
        <View style={styles.row}>
          <Text style={styles.label}>PAYLOAD</Text>
          <Text style={styles.hex} selectable>
            {formatHex(detail.hex)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space.sm,
  },
  headline: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    lineHeight: 22,
  },
  warning: {
    color: colors.accent,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  note: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    gap: 4,
  },
  label: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  value: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
  mono: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
  },
  hex: {
    color: colors.ok,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
});
