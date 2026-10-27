/**
 * Locale leaves may be a string or a platform map.
 * `t('settings.faceId')` then resolves Face ID / Touch ID on iOS and
 * fingerprint / biometrics copy on Android, without renaming consumer keys.
 */
export type PlatformCopy = {
  ios: string;
  android: string;
  default: string;
};

export function isPlatformCopy(value: unknown): value is PlatformCopy {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.ios === 'string' &&
    typeof rec.android === 'string' &&
    typeof rec.default === 'string'
  );
}

export function copyPlatform(os: string): keyof PlatformCopy {
  if (os === 'ios' || os === 'android') {
    return os;
  }
  return 'default';
}

export function resolvePlatformCopy(value: unknown, os: string): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!isPlatformCopy(value)) {
    return undefined;
  }
  return value[copyPlatform(os)];
}
