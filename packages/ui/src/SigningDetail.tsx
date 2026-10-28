import { StyleSheet, Text, View } from 'react-native';
import { BTC_ZERO_HMAC_WARNING, describeSigning, type SigningDetail, type SigningRequest } from '@cws/contracts';
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
  payload?: string;
  purposeSign?: string;
  purposeAddress?: string;
  purposeVerify?: string;
  purposeOpenApp?: string;
  purposeManager?: string;
  purposePairing?: string;
  purposeExportSeed?: string;
  headlineBtcTx?: string;
  headlineEthTx?: string;
  headlineTokenTransfer?: string;
  headlineTokenApprove?: string;
  headlineEip712?: string;
  headlineEip7702?: string;
  notice7702?: string;
  noticeZeroHmac?: string;
  fieldLabels?: Record<string, string>;
};

type Props = {
  request: SigningRequest;
  copy?: SigningCopy;
};

const HEADLINE_MAP: Array<{ match: string; key: keyof SigningCopy }> = [
  { match: 'Sign Bitcoin transaction', key: 'headlineBtcTx' },
  { match: 'Ethereum transaction', key: 'headlineEthTx' },
  { match: 'Token transfer', key: 'headlineTokenTransfer' },
  { match: 'Token approve', key: 'headlineTokenApprove' },
  { match: 'EIP-712 typed data', key: 'headlineEip712' },
  { match: 'EIP-7702 authorization', key: 'headlineEip7702' },
];

function purposeFor(request: SigningRequest, copy?: SigningCopy): string | undefined {
  switch (request.kind) {
    case 'sign':
      return copy?.purposeSign;
    case 'address':
      return copy?.purposeAddress;
    case 'verify':
      return copy?.purposeVerify;
    case 'open-app':
      return copy?.purposeOpenApp;
    case 'allow-manager':
      return copy?.purposeManager;
    case 'pairing':
      return copy?.purposePairing;
    case 'export-seed':
      return copy?.purposeExportSeed;
    default:
      return undefined;
  }
}

function localizeHeadline(headline: string, copy?: SigningCopy): string {
  for (const entry of HEADLINE_MAP) {
    if (headline === entry.match) {
      const next = copy?.[entry.key];
      if (typeof next === 'string' && next) {
        return next;
      }
    }
  }
  return headline;
}

function localizeFieldLabel(label: string, copy?: SigningCopy): string {
  const mapped = copy?.fieldLabels?.[label];
  return mapped ?? label;
}

function localize(detail: SigningDetail, request: SigningRequest, copy?: SigningCopy): SigningDetail {
  let headline = detail.headline;
  let warning = detail.warning;
  if (detail.headline === 'EIP-7702 authorization' && copy?.notice7702) {
    warning = copy.notice7702;
  }
  if (warning === BTC_ZERO_HMAC_WARNING && copy?.noticeZeroHmac) {
    warning = copy.noticeZeroHmac;
  }
  if (detail.decodeFailed && copy?.decodeFailed) {
    headline = copy.decodeFailed;
  } else {
    headline = localizeHeadline(headline, copy);
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
  return {
    ...detail,
    headline,
    warning,
    fields: detail.fields.map((field) => ({
      ...field,
      label: localizeFieldLabel(field.label, copy),
    })),
  };
}

export function SigningDetailView({ request, copy }: Props) {
  const detail = localize(describeSigning(request), request, copy);
  const purpose = purposeFor(request, copy);
  return (
    <View style={styles.box}>
      {purpose ? <Text style={styles.purpose}>{purpose}</Text> : null}
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
          <Text style={styles.label}>{copy?.payload ?? 'PAYLOAD'}</Text>
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
  purpose: {
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
