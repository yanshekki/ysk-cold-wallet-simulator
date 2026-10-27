export type QrProfileId =
  | 'keystone'
  | 'onekey'
  | 'ngrave-zero'
  | 'airgap'
  | 'coolwallet'
  | 'imtoken'
  | 'arculus'
  | 'dcent'
  | 'keycard-shell'
  | 'ellipal'
  | 'coldcard';

export type QrUrKind =
  | 'crypto-hdkey'
  | 'crypto-multi-accounts'
  | 'crypto-account'
  | 'crypto-output'
  | 'crypto-seed';

export type QrFormatId =
  | 'eth-hdkey'
  | 'eth-multi'
  | 'eth-account'
  | 'btc-hdkey'
  | 'btc-nested'
  | 'btc-legacy'
  | 'btc-taproot'
  | 'btc-test'
  | 'btc-output'
  | 'crypto-seed'
  | 'bbqr-xpub';

export type QrWalletHint = 'rabby+metamask' | 'metamask' | 'sparrow';

export interface QrProfile {
  id: QrProfileId;
  name: string;
  defaultUr: 'crypto-hdkey';
  extraUrs?: QrUrKind[];
  walletHint: QrWalletHint;
}

export const QR_PROFILES: readonly QrProfile[] = [
  {
    id: 'keystone',
    name: 'Keystone',
    defaultUr: 'crypto-hdkey',
    extraUrs: ['crypto-multi-accounts', 'crypto-account', 'crypto-seed'],
    walletHint: 'rabby+metamask',
  },
  {
    id: 'onekey',
    name: 'OneKey',
    defaultUr: 'crypto-hdkey',
    extraUrs: ['crypto-multi-accounts', 'crypto-account', 'crypto-seed'],
    walletHint: 'rabby+metamask',
  },
  {
    id: 'ngrave-zero',
    name: 'NGRAVE ZERO',
    defaultUr: 'crypto-hdkey',
    walletHint: 'rabby+metamask',
  },
  {
    id: 'airgap',
    name: 'AirGap Vault',
    defaultUr: 'crypto-hdkey',
    extraUrs: ['crypto-multi-accounts', 'crypto-account', 'crypto-seed'],
    walletHint: 'rabby+metamask',
  },
  {
    id: 'coolwallet',
    name: 'CoolWallet',
    defaultUr: 'crypto-hdkey',
    walletHint: 'rabby+metamask',
  },
  {
    id: 'imtoken',
    name: 'imToken',
    defaultUr: 'crypto-hdkey',
    walletHint: 'rabby+metamask',
  },
  {
    id: 'arculus',
    name: 'Arculus',
    defaultUr: 'crypto-hdkey',
    walletHint: 'metamask',
  },
  {
    id: 'dcent',
    name: "D'CENT",
    defaultUr: 'crypto-hdkey',
    walletHint: 'metamask',
  },
  {
    id: 'keycard-shell',
    name: 'Keycard Shell',
    defaultUr: 'crypto-hdkey',
    walletHint: 'metamask',
  },
  {
    id: 'ellipal',
    name: 'ELLIPAL',
    defaultUr: 'crypto-hdkey',
    walletHint: 'metamask',
  },
  {
    id: 'coldcard',
    name: 'Coldcard',
    defaultUr: 'crypto-hdkey',
    walletHint: 'sparrow',
  },
];

const FORMAT_IDS: readonly QrFormatId[] = [
  'eth-hdkey',
  'eth-multi',
  'eth-account',
  'btc-hdkey',
  'btc-nested',
  'btc-legacy',
  'btc-taproot',
  'btc-test',
  'btc-output',
  'crypto-seed',
  'bbqr-xpub',
];

export function qrProfile(id: QrProfileId): QrProfile {
  const profile = QR_PROFILES.find((item) => item.id === id);
  if (!profile) {
    throw new Error(`unknown QR profile ${id}`);
  }
  return profile;
}

export function qrProfileHasMultiAccounts(profile: QrProfile): boolean {
  return profile.extraUrs?.includes('crypto-multi-accounts') === true;
}

export function isQrFormatId(value: string): value is QrFormatId {
  return FORMAT_IDS.includes(value as QrFormatId);
}

export function resolveQrFormat(kind?: QrFormatId | QrUrKind): QrFormatId {
  if (kind === 'eth-multi' || kind === 'crypto-multi-accounts') {
    return 'eth-multi';
  }
  if (kind === 'eth-account' || kind === 'crypto-account') {
    return 'eth-account';
  }
  if (kind === 'crypto-output') {
    return 'btc-output';
  }
  if (kind === 'crypto-seed') {
    return 'crypto-seed';
  }
  if (
    kind === 'btc-hdkey' ||
    kind === 'btc-nested' ||
    kind === 'btc-legacy' ||
    kind === 'btc-taproot' ||
    kind === 'btc-test' ||
    kind === 'btc-output' ||
    kind === 'bbqr-xpub'
  ) {
    return kind;
  }
  return 'eth-hdkey';
}

export function qrFormatsFor(profile: QrProfile): QrFormatId[] {
  if (profile.id === 'coldcard') {
    return ['bbqr-xpub', 'btc-hdkey', 'btc-nested', 'btc-legacy', 'btc-taproot'];
  }
  const formats: QrFormatId[] = ['eth-hdkey'];
  if (qrProfileHasMultiAccounts(profile)) {
    formats.push('eth-multi');
  }
  if (profile.extraUrs?.includes('crypto-account')) {
    formats.push('eth-account');
  }
  formats.push('btc-hdkey', 'btc-nested', 'btc-legacy', 'btc-taproot', 'btc-test', 'btc-output');
  if (profile.extraUrs?.includes('crypto-seed')) {
    formats.push('crypto-seed');
  }
  return formats;
}
