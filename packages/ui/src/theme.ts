import { Platform } from 'react-native';
import type { Brand } from '@cws/contracts';

export const colors = {
  bg: '#0B0C0F',
  bgElevated: '#14161C',
  card: '#1B1E26',
  border: '#2C3140',
  text: '#F4F1EA',
  muted: '#9A9488',
  accent: '#FF5A1F',
  accentDim: '#3A1C12',
  ok: '#C8F542',
  danger: '#FF5C7A',
  ledger: '#FF5A1F',
  trezor: '#4A90D9',
  onekey: '#44D62C',
};

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
};

export const fonts = {
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, Menlo, Courier, monospace',
  }) as string,
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
