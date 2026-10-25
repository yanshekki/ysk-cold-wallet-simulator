import { ALL_MODELS, bleAdvertiseName, type Brand } from '@cws/contracts';

export function walletServiceUuids(brand: Brand): string[] {
  return [
    ...new Set(
      ALL_MODELS.filter((item) => item.brand === brand).map((item) => item.serviceUUID.toLowerCase()),
    ),
  ];
}

export function walletNameFilters(brand: Brand): Array<{ namePrefix: string }> {
  const prefixes = new Set<string>();
  for (const model of ALL_MODELS.filter((item) => item.brand === brand)) {
    const name = bleAdvertiseName(model);
    prefixes.add(name);
    const token = name.split(/\s+/)[0] ?? name;
    if (token.length >= 2) {
      prefixes.add(token);
    }
  }
  return [...prefixes].map((namePrefix) => ({ namePrefix }));
}

export function walletRequestOptions(
  brand: Brand,
  acceptAll: boolean,
): {
  filters?: Array<{ namePrefix: string }>;
  acceptAllDevices?: boolean;
  optionalServices: string[];
} {
  const optionalServices = walletServiceUuids(brand);
  if (acceptAll) {
    return { acceptAllDevices: true, optionalServices };
  }
  return { filters: walletNameFilters(brand), optionalServices };
}

export function shouldWidenScan(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (/cancell?ed/i.test(message) || name === 'AbortError') {
    return false;
  }
  if (name === 'TypeError') {
    return true;
  }
  return /no bluetooth devices|not found|invalid filter|must not be empty/i.test(message);
}

export function bluetoothBlockReason(input: {
  bluetooth: boolean;
  secureContext: boolean;
  brave: boolean;
}): string | null {
  if (!input.secureContext) {
    return 'Insecure origin';
  }
  if (!input.bluetooth) {
    return input.brave ? 'Brave Web Bluetooth disabled' : 'Web Bluetooth is not available';
  }
  return null;
}
