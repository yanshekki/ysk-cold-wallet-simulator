import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BTC_ZERO_HMAC_WARNING,
  HOST_SUPPLIED_HASH_WARNING,
  OPAQUE_CALLDATA_NOTE,
  describeSigning,
  type SigningDetail,
  type SigningRequest,
} from '@cws/contracts';
import { formatHex } from './logFormat';
import { layoutSigningDetail, type RawHexRow } from './signingLayout';
import { colors, fonts, hairline, space } from './theme';

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
  noticeHostHash?: string;
  headlineHostHash?: string;
  opaqueCalldata?: string;
  rawSection?: string;
  showRaw?: string;
  hideRaw?: string;
  copyRaw?: string;
  copiedRaw?: string;
  rawBytes?: string;
  fieldLabels?: Record<string, string>;
};

export type SigningHexCopy = (value: string) => void | boolean | Promise<void | boolean>;

type Props = {
  request: SigningRequest;
  copy?: SigningCopy;
  onCopyHex?: SigningHexCopy;
};

const HEADLINE_MAP: Array<{ match: string; key: keyof SigningCopy }> = [
  { match: 'Sign Bitcoin transaction', key: 'headlineBtcTx' },
  { match: 'Ethereum transaction', key: 'headlineEthTx' },
  { match: 'Token transfer', key: 'headlineTokenTransfer' },
  { match: 'Token approve', key: 'headlineTokenApprove' },
  { match: 'EIP-712 typed data', key: 'headlineEip712' },
  { match: 'EIP-7702 authorization', key: 'headlineEip7702' },
  { match: 'Host-supplied hash', key: 'headlineHostHash' },
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
  let note = detail.note;
  if (detail.headline === 'EIP-7702 authorization' && copy?.notice7702) {
    warning = copy.notice7702;
  }
  if (warning === BTC_ZERO_HMAC_WARNING && copy?.noticeZeroHmac) {
    warning = copy.noticeZeroHmac;
  }
  if (warning === HOST_SUPPLIED_HASH_WARNING && copy?.noticeHostHash) {
    warning = copy.noticeHostHash;
  }
  if (warning === OPAQUE_CALLDATA_NOTE && copy?.opaqueCalldata) {
    warning = copy.opaqueCalldata;
  }
  if (note === OPAQUE_CALLDATA_NOTE && copy?.opaqueCalldata) {
    note = copy.opaqueCalldata;
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
    note,
    fields: detail.fields.map((field) => ({
      ...field,
      label: localizeFieldLabel(field.label, copy),
    })),
  };
}

export function SigningDetailView({ request, copy, onCopyHex }: Props) {
  const detail = localize(describeSigning(request), request, copy);
  const purpose = purposeFor(request, copy);
  const selectable = request.kind !== 'export-seed';
  const laid = layoutSigningDetail(detail, {
    rawSection: copy?.rawSection ?? 'Raw data',
    payload: copy?.payload ?? 'PAYLOAD',
  });
  return (
    <View style={styles.box}>
      {purpose ? <Text style={styles.purpose}>{purpose}</Text> : null}
      <Text style={styles.headline}>{detail.headline}</Text>
      {detail.warning ? <Text style={styles.warning}>{detail.warning}</Text> : null}
      {detail.note ? <Text style={styles.note}>{detail.note}</Text> : null}
      {laid.summary.map((field) => (
        <View key={`${field.label}:${field.value.slice(0, 24)}`} style={styles.row}>
          <Text style={styles.label}>{field.label}</Text>
          <Text style={field.mono ? styles.mono : styles.value} selectable={selectable}>
            {field.value}
          </Text>
        </View>
      ))}
      {laid.raw.length > 0 ? (
        <View style={styles.rawSection} testID="signing-raw-section">
          {laid.rawSection ? <Text style={styles.label}>{laid.rawSection}</Text> : null}
          {laid.raw.map((row) => (
            <HexBlock
              key={row.id}
              row={row}
              selectable={selectable}
              showLabel={copy?.showRaw ?? 'Show'}
              hideLabel={copy?.hideRaw ?? 'Hide'}
              copyLabel={copy?.copyRaw ?? 'Copy'}
              copiedLabel={copy?.copiedRaw ?? 'Copied'}
              byteTemplate={copy?.rawBytes ?? '{{n}} bytes'}
              onCopy={onCopyHex}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HexBlock({
  row,
  selectable,
  showLabel,
  hideLabel,
  copyLabel,
  copiedLabel,
  byteTemplate,
  onCopy,
}: {
  row: RawHexRow;
  selectable: boolean;
  showLabel: string;
  hideLabel: string;
  copyLabel: string;
  copiedLabel: string;
  byteTemplate: string;
  onCopy?: SigningHexCopy;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (copied === 0) {
      return;
    }
    const timer = setTimeout(() => setCopied(0), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const text =
    row.collapsed && !open ? row.preview : row.bytes == null ? row.value : formatHex(row.value);
  const showBar = row.bytes != null || row.collapsed || Boolean(onCopy);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{row.label}</Text>
      <Text style={styles.hex} selectable={selectable}>
        {text}
      </Text>
      {showBar ? (
        <View style={styles.hexBar}>
          {row.bytes != null ? (
            <Text style={styles.hexMeta}>{byteTemplate.replace('{{n}}', String(row.bytes))}</Text>
          ) : null}
          <View style={styles.hexActions}>
            {row.collapsed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${open ? hideLabel : showLabel} ${row.label}`}
                accessibilityState={{ expanded: open }}
                hitSlop={8}
                onPress={() => setOpen((value) => !value)}
                testID={`signing-hex-toggle-${row.id}`}
              >
                <Text style={styles.hexAction}>{open ? hideLabel : showLabel}</Text>
              </Pressable>
            ) : null}
            {onCopy ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${copyLabel} ${row.label}`}
                hitSlop={8}
                onPress={() => {
                  void Promise.resolve()
                    .then(() => onCopy(row.value))
                    .then((result) => {
                      if (result !== false) {
                        setCopied((count) => count + 1);
                      }
                    })
                    .catch(() => undefined);
                }}
                testID={`signing-hex-copy-${row.id}`}
              >
                <Text style={styles.hexAction}>{copied > 0 ? copiedLabel : copyLabel}</Text>
              </Pressable>
            ) : null}
          </View>
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
  rawSection: {
    gap: space.sm,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    paddingTop: space.xs,
  },
  hexBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  hexActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginLeft: 'auto',
  },
  hexMeta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  hexAction: {
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 0.4,
  },
});
