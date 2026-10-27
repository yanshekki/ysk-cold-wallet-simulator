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

export type QrFormatGroupId = 'eth' | 'btc' | 'bbqr' | 'sensitive';

export type QrFormatGroup = {
  id: QrFormatGroupId;
  formats: QrFormatId[];
};

const FORMAT_GROUP: Record<QrFormatId, QrFormatGroupId> = {
  'eth-hdkey': 'eth',
  'eth-multi': 'eth',
  'eth-account': 'eth',
  'btc-hdkey': 'btc',
  'btc-nested': 'btc',
  'btc-legacy': 'btc',
  'btc-taproot': 'btc',
  'btc-test': 'btc',
  'btc-output': 'btc',
  'bbqr-xpub': 'bbqr',
  'crypto-seed': 'sensitive',
};

/** Display path that encodeQrAccount puts on the QR for each format. */
const FORMAT_PATH: Record<QrFormatId, string> = {
  'eth-hdkey': "m/44'/60'/0'/0/0",
  'eth-multi': "m/44'/60'/0'/0/0",
  'eth-account': "m/44'/60'/0'/0/0",
  'btc-hdkey': "m/84'/0'/0'/0/0",
  'btc-nested': "m/49'/0'/0'/0/0",
  'btc-legacy': "m/44'/0'/0'/0/0",
  'btc-taproot': "m/86'/0'/0'/0/0",
  'btc-test': "m/84'/1'/0'/0/0",
  'btc-output': "m/84'/0'/0'/0/0",
  'bbqr-xpub': "m/84'/0'/0'/0/0",
  'crypto-seed': 'm',
};

const FORMAT_UR_LABEL: Record<QrFormatId, string> = {
  'eth-hdkey': 'crypto-hdkey',
  'eth-multi': 'crypto-multi-accounts',
  'eth-account': 'crypto-account',
  'btc-hdkey': 'crypto-hdkey',
  'btc-nested': 'crypto-hdkey',
  'btc-legacy': 'crypto-hdkey',
  'btc-taproot': 'crypto-hdkey',
  'btc-test': 'crypto-hdkey',
  'btc-output': 'crypto-output',
  'bbqr-xpub': 'BBQr',
  'crypto-seed': 'crypto-seed',
};

const GROUP_ORDER: readonly QrFormatGroupId[] = ['eth', 'btc', 'bbqr', 'sensitive'];

export function qrFormatGroupOf(id: QrFormatId): QrFormatGroupId {
  return FORMAT_GROUP[id];
}

export function qrFormatPath(id: QrFormatId): string {
  return FORMAT_PATH[id];
}

export function qrFormatUrLabel(id: QrFormatId): string {
  return FORMAT_UR_LABEL[id];
}

/** Subtitle for format picker rows: encoding kind + derivation path. */
export function qrFormatDetail(id: QrFormatId): string {
  return `${FORMAT_UR_LABEL[id]} · ${FORMAT_PATH[id]}`;
}

export function defaultQrFormat(profile: QrProfile): QrFormatId {
  return profile.id === 'coldcard' ? 'bbqr-xpub' : 'eth-hdkey';
}

/**
 * Group `qrFormatsFor` results for the format picker.
 * Preserves relative order within each group; omits empty groups.
 */
export function groupQrFormats(formats: readonly QrFormatId[]): QrFormatGroup[] {
  const buckets: Record<QrFormatGroupId, QrFormatId[]> = {
    eth: [],
    btc: [],
    bbqr: [],
    sensitive: [],
  };
  for (const id of formats) {
    buckets[FORMAT_GROUP[id]].push(id);
  }
  return GROUP_ORDER.filter((group) => buckets[group].length > 0).map((id) => ({
    id,
    formats: buckets[id],
  }));
}
