import { Platform, StyleSheet } from 'react-native';
import type { Brand } from '@cws/contracts';

export const colors = {
  bg: '#07080A',
  bgElevated: '#0E1014',
  card: '#0A0C10',
  border: '#2A3038',
  text: '#E6E8EC',
  muted: '#7C8491',
  accent: '#FF5A1F',
  accentDim: '#3A1C12',
  ok: '#C8F542',
  danger: '#FF5C7A',
  ledger: '#FF5A1F',
  trezor: '#4A90D9',
  onekey: '#44D62C',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
};

export const radius = {
  sm: 2,
  md: 4,
  lg: 6,
};

export const hairline = StyleSheet.hairlineWidth;

export const fonts = {
  sans: 'IBMPlexSans_400Regular',
  sansMedium: 'IBMPlexSans_500Medium',
  sansSemi: 'IBMPlexSans_600SemiBold',
  sansBold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoBold: 'IBMPlexMono_700Bold',
  systemMono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, Menlo, Courier, monospace',
  }) as string,
};

export const typography = {
  kicker: {
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.muted,
    textTransform: 'uppercase' as const,
  },
  title: {
    fontFamily: fonts.sansSemi,
    fontSize: 20,
    letterSpacing: 0.2,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  meta: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  data: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text,
  },
};

export const BRAND_LABEL: Record<Brand, string> = {
  ledger: 'Ledger',
  trezor: 'Trezor',
  onekey: 'OneKey',
};

export function brandColor(brand: Brand): string {
  return colors[brand];
}

export const motion = {
  sheet: 220,
  enter: 180,
  radioPulse: 1600,
};
