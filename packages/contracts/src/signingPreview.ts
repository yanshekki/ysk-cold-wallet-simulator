import type { SigningRequest } from './signing';

export type SigningStyle =
  | 'eth-tx'
  | 'eth-message'
  | 'address'
  | 'btc-hash'
  | 'btc-message'
  | 'raw-sign'
  | 'notice';

export type SigningField = {
  label: string;
  value: string;
  mono?: boolean;
};

export type SigningDetail = {
  style: SigningStyle;
  headline: string;
  warning?: string;
  fields: SigningField[];
  hex?: string;
  note?: string;
  decodeFailed?: boolean;
};

type Rlp = Uint8Array | Rlp[];

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function hex0x(bytes: Uint8Array): string {
  return bytes.length === 0 ? '0x' : `0x${toHex(bytes)}`;
}

function readInt(bytes: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) {
    value = (value << 8) + bytes[offset + i]!;
  }
  return value;
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}

export function formatWeiEth(wei: bigint): { eth: string; wei: string } {
  const unit = 1_000_000_000_000_000_000n;
  const whole = wei / unit;
  const frac = wei % unit;
  const eth =
    frac === 0n ? `${whole} ETH` : `${whole}.${frac.toString().padStart(18, '0').replace(/0+$/, '')} ETH`;
  return { eth, wei: `${wei.toString()} wei` };
}

export function formatSatsBtc(sats: bigint): string {
  const unit = 100_000_000n;
  const sign = sats < 0n ? '-' : '';
  const value = sats < 0n ? -sats : sats;
  const whole = value / unit;
  const frac = value % unit;
  if (frac === 0n) {
    return `${sign}${whole} BTC`;
  }
  return `${sign}${whole}.${frac.toString().padStart(8, '0').replace(/0+$/, '')} BTC`;
}

/** Shown when a default policy is signed with an all-zero HMAC that was not checked. */
export const BTC_ZERO_HMAC_WARNING = 'Policy HMAC is all zeros and was not checked.';

export function describeBtcPsbt(input: {
  path: string;
  outputs: Array<{ address: string; amountSats: bigint }>;
  feeSats?: bigint;
  /** Default-policy template accepted because the policy HMAC was 32 zero bytes. */
  uncheckedPolicy?: string;
}): SigningDetail {
  const fields: SigningField[] = [
    { label: 'CHAIN', value: 'Bitcoin' },
    { label: 'PATH', value: input.path, mono: true },
  ];
  if (input.uncheckedPolicy) {
    fields.unshift({ label: 'POLICY', value: input.uncheckedPolicy, mono: true });
  }
  for (const output of input.outputs) {
    fields.push({ label: 'TO', value: output.address, mono: true });
    fields.push({ label: 'VALUE', value: formatSatsBtc(output.amountSats) });
  }
  if (input.feeSats != null) {
    fields.push({ label: 'FEE', value: formatSatsBtc(input.feeSats) });
  }
  return {
    style: 'btc-hash',
    headline: 'Sign Bitcoin transaction',
    warning: input.uncheckedPolicy ? BTC_ZERO_HMAC_WARNING : undefined,
    fields,
  };
}

function formatAddress(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '(contract create)';
  }
  return hex0x(bytes);
}

function asPrintable(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.includes('\uFFFD')) {
      return null;
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

function decodeRlp(bytes: Uint8Array, offset = 0): { value: Rlp; next: number } | null {
  if (offset >= bytes.length) {
    return null;
  }
  const prefix = bytes[offset]!;
  if (prefix <= 0x7f) {
    return { value: bytes.subarray(offset, offset + 1), next: offset + 1 };
  }
  if (prefix <= 0xb7) {
    const len = prefix - 0x80;
    const start = offset + 1;
    if (bytes.length < start + len) {
      return null;
    }
    return { value: bytes.subarray(start, start + len), next: start + len };
  }
  if (prefix <= 0xbf) {
    const lenOfLen = prefix - 0xb7;
    if (bytes.length < offset + 1 + lenOfLen) {
      return null;
    }
    const len = readInt(bytes, offset + 1, lenOfLen);
    const start = offset + 1 + lenOfLen;
    if (len < 0 || bytes.length < start + len) {
      return null;
    }
    return { value: bytes.subarray(start, start + len), next: start + len };
  }
  if (prefix <= 0xf7) {
    const len = prefix - 0xc0;
    const start = offset + 1;
    if (bytes.length < start + len) {
      return null;
    }
    const items = decodeList(bytes.subarray(start, start + len));
    return items ? { value: items, next: start + len } : null;
  }
  const lenOfLen = prefix - 0xf7;
  if (bytes.length < offset + 1 + lenOfLen) {
    return null;
  }
  const len = readInt(bytes, offset + 1, lenOfLen);
  const start = offset + 1 + lenOfLen;
  if (len < 0 || bytes.length < start + len) {
    return null;
  }
  const items = decodeList(bytes.subarray(start, start + len));
  return items ? { value: items, next: start + len } : null;
}

function decodeList(body: Uint8Array): Rlp[] | null {
  const items: Rlp[] = [];
  let offset = 0;
  while (offset < body.length) {
    const next = decodeRlp(body, offset);
    if (!next) {
      return null;
    }
    items.push(next.value);
    offset = next.next;
  }
  return items;
}

function asBytes(item: Rlp | undefined): Uint8Array | null {
  return item instanceof Uint8Array ? item : null;
}

export type EthTxInput = {
  path?: string;
  type?: string;
  chainId?: number | Uint8Array;
  nonce?: Uint8Array;
  gasPrice?: Uint8Array;
  gasLimit?: Uint8Array;
  maxFeePerGas?: Uint8Array;
  maxPriorityFeePerGas?: Uint8Array;
  maxFeePerBlobGas?: Uint8Array;
  to?: Uint8Array;
  value?: Uint8Array;
  data?: Uint8Array;
  accessListCount?: number;
  blobCount?: number;
  authorizationCount?: number;
  token?: { ticker: string; decimals: number; contract?: Uint8Array };
  envelopeHex?: string;
};

function formatChainId(value: number | Uint8Array | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return bigintFromBytes(value).toString();
}

export function describeEthTransaction(input: EthTxInput): SigningDetail {
  const fields: SigningField[] = [];
  const push = (label: string, value: string | undefined, mono = true) => {
    if (value) {
      fields.push({ label, value, mono });
    }
  };
  push('PATH', input.path);
  push('TYPE', input.type);
  push('CHAIN ID', formatChainId(input.chainId));
  if (input.to) {
    push('TO', formatAddress(input.to));
  }
  if (input.value) {
    const formatted = formatWeiEth(bigintFromBytes(input.value));
    push('VALUE', formatted.eth);
    push('WEI', formatted.wei);
  }
  if (input.nonce) {
    push('NONCE', bigintFromBytes(input.nonce).toString());
  }
  if (input.gasLimit) {
    push('GAS', bigintFromBytes(input.gasLimit).toString());
  }
  if (input.gasPrice) {
    push('GAS PRICE', `${bigintFromBytes(input.gasPrice).toString()} wei`);
  }
  if (input.maxFeePerGas) {
    push('MAX FEE', `${bigintFromBytes(input.maxFeePerGas).toString()} wei`);
  }
  if (input.maxPriorityFeePerGas) {
    push('MAX PRIORITY', `${bigintFromBytes(input.maxPriorityFeePerGas).toString()} wei`);
  }
  if (input.accessListCount && input.accessListCount > 0) {
    push('ACCESS LIST', `${input.accessListCount} keys`, false);
  }
  if (input.maxFeePerBlobGas) {
    push('BLOB FEE', `${bigintFromBytes(input.maxFeePerBlobGas).toString()} wei`);
  }
  if (input.blobCount && input.blobCount > 0) {
    push('BLOBS', String(input.blobCount), false);
  }
  if (input.authorizationCount && input.authorizationCount > 0) {
    push('AUTHORIZATIONS', String(input.authorizationCount), false);
  }
  const data = input.data ?? new Uint8Array();
  const erc20 = describeErc20(data, input.token, input.to);
  if (erc20) {
    for (const field of erc20.fields) {
      fields.push(field);
    }
  } else if (data.length >= 4) {
    push('SELECTOR', hex0x(data.subarray(0, 4)));
  }
  if (data.length > 0 && !erc20) {
    push('DATA', hex0x(data));
  }
  return {
    style: 'eth-tx',
    headline: erc20?.headline ?? 'Ethereum transaction',
    warning: erc20?.warning,
    fields,
    hex: input.envelopeHex,
  };
}

function describeErc20(
  data: Uint8Array,
  token?: { ticker: string; decimals: number; contract?: Uint8Array },
  to?: Uint8Array,
): { headline: string; warning?: string; fields: SigningField[] } | null {
  if (data.length < 68) {
    return null;
  }
  const selector = toHex(data.subarray(0, 4));
  const method = selector === 'a9059cbb' ? 'transfer' : selector === '095ea7b3' ? 'approve' : null;
  if (!method) {
    return null;
  }
  const target = data.subarray(16, 36);
  const amount = bigintFromBytes(data.subarray(36, 68));
  const contract = token?.contract && token.contract.length > 0 ? token.contract : to;
  const fields: SigningField[] = [
    { label: 'METHOD', value: method },
  ];
  if (contract && contract.length > 0) {
    fields.push({ label: 'CONTRACT', value: hex0x(contract), mono: true });
  }
  fields.push({
    label: method === 'transfer' ? 'TO' : 'SPENDER',
    value: hex0x(target),
    mono: true,
  });
  fields.push({ label: 'AMOUNT RAW', value: amount.toString() });
  if (token) {
    const decimals = token.decimals ?? 18;
    const unit = 10n ** BigInt(decimals);
    const whole = amount / unit;
    const frac = amount % unit;
    const formatted =
      frac === 0n
        ? whole.toString()
        : `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
    fields.push({ label: 'AMOUNT', value: `${formatted} (host decimals)` });
    if (token.ticker) {
      fields.push({ label: 'TICKER', value: `${token.ticker} (host-provided)` });
    }
  }
  return {
    headline: method === 'transfer' ? 'Token transfer' : 'Token approve',
    warning: token
      ? 'Token ticker and decimals were provided by the host and are not verified.'
      : undefined,
    fields,
  };
}

/** Shown when the host sent a hash instead of a decoded transaction or typed data. */
export const HOST_SUPPLIED_HASH_WARNING =
  'The host supplied this hash. It is not a decoded transaction.';

export function describeHostSuppliedHash(input: {
  path: string;
  domainHash: Uint8Array;
  messageHash: Uint8Array;
}): SigningDetail {
  return {
    style: 'raw-sign',
    headline: 'Host-supplied hash',
    warning: HOST_SUPPLIED_HASH_WARNING,
    fields: [
      { label: 'PATH', value: input.path, mono: true },
      { label: 'DOMAIN HASH', value: hex0x(input.domainHash), mono: true },
      { label: 'MESSAGE HASH', value: hex0x(input.messageHash), mono: true },
    ],
  };
}

/** Review for a raw 32-byte hash the host asked the Bitcoin app to sign. */
export function describeHostSuppliedDigest(input: {
  chain: string;
  path: string;
  hash: Uint8Array;
}): SigningDetail {
  return {
    style: 'raw-sign',
    headline: 'Host-supplied hash',
    warning: HOST_SUPPLIED_HASH_WARNING,
    fields: [
      { label: 'CHAIN', value: input.chain },
      { label: 'PATH', value: input.path, mono: true },
      { label: 'HASH', value: hex0x(input.hash), mono: true },
    ],
  };
}

export function describeEthTypedData(path: string, json: Uint8Array): SigningDetail {
  const text = asPrintable(json);
  let primary = '';
  let domain = '';
  if (text) {
    try {
      const parsed = JSON.parse(text) as { primaryType?: unknown; domain?: { name?: unknown } };
      if (typeof parsed.primaryType === 'string') {
        primary = parsed.primaryType;
      }
      if (typeof parsed.domain?.name === 'string') {
        domain = parsed.domain.name;
      }
    } catch {
      // fall through to hex dump
    }
  }
  const fields: SigningField[] = [{ label: 'PATH', value: path, mono: true }];
  if (primary) {
    fields.push({ label: 'TYPE', value: primary });
  }
  if (domain) {
    fields.push({ label: 'DOMAIN', value: domain });
  }
  return {
    style: 'eth-message',
    headline: 'EIP-712 typed data',
    fields,
    hex: primary ? undefined : hex0x(json),
  };
}

export function describeEthMessage(path: string, message: Uint8Array): SigningDetail {
  const text = asPrintable(message);
  if (text) {
    return {
      style: 'eth-message',
      headline: 'Personal message',
      fields: [
        { label: 'PATH', value: path, mono: true },
        { label: 'MESSAGE', value: text, mono: true },
      ],
    };
  }
  return {
    style: 'eth-message',
    headline: 'Raw hash / binary message',
    fields: [{ label: 'PATH', value: path, mono: true }],
    hex: hex0x(message),
  };
}

export function parseEthTx(raw: Uint8Array): EthTxInput | null {
  if (raw.length === 0) {
    return null;
  }
  let type = 'legacy';
  let offset = 0;
  if (raw[0]! <= 0x04 && raw.length > 1 && raw[1]! >= 0xc0) {
    if (raw[0] === 0x01) {
      type = 'eip2930';
    } else if (raw[0] === 0x02) {
      type = 'eip1559';
    } else if (raw[0] === 0x03) {
      type = 'eip4844';
    } else if (raw[0] === 0x04) {
      type = 'eip7702';
    }
    offset = 1;
  }
  const decoded = decodeRlp(raw, offset);
  if (!decoded || !Array.isArray(decoded.value)) {
    return null;
  }
  const items = decoded.value;
  const envelopeHex = hex0x(raw);
  if (type === 'eip1559' || type === 'eip4844' || type === 'eip7702') {
    if (items.length < 8) {
      return null;
    }
    const chainId = asBytes(items[0]);
    const nonce = asBytes(items[1]);
    const maxPriorityFeePerGas = asBytes(items[2]);
    const maxFeePerGas = asBytes(items[3]);
    const gasLimit = asBytes(items[4]);
    const to = asBytes(items[5]);
    const value = asBytes(items[6]);
    const data = asBytes(items[7]);
    if (!chainId || !nonce || !maxPriorityFeePerGas || !maxFeePerGas || !gasLimit || !to || !value || !data) {
      return null;
    }
    const access = items[8];
    const parsed: EthTxInput = {
      type,
      chainId,
      nonce,
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      to,
      value,
      data,
      accessListCount: Array.isArray(access) ? access.length : undefined,
      envelopeHex,
    };
    if (type === 'eip4844') {
      parsed.maxFeePerBlobGas = asBytes(items[9]) ?? undefined;
      const blobs = items[10];
      parsed.blobCount = Array.isArray(blobs) ? blobs.length : undefined;
    }
    if (type === 'eip7702') {
      const auths = items[9];
      parsed.authorizationCount = Array.isArray(auths) ? auths.length : undefined;
    }
    return parsed;
  }
  if (type === 'eip2930') {
    if (items.length < 7) {
      return null;
    }
    const chainId = asBytes(items[0]);
    const nonce = asBytes(items[1]);
    const gasPrice = asBytes(items[2]);
    const gasLimit = asBytes(items[3]);
    const to = asBytes(items[4]);
    const value = asBytes(items[5]);
    const data = asBytes(items[6]);
    if (!chainId || !nonce || !gasPrice || !gasLimit || !to || !value || !data) {
      return null;
    }
    const access = items[7];
    return {
      type,
      chainId,
      nonce,
      gasPrice,
      gasLimit,
      to,
      value,
      data,
      accessListCount: Array.isArray(access) ? access.length : undefined,
      envelopeHex,
    };
  }
  if (items.length < 6) {
    return null;
  }
  const nonce = asBytes(items[0]);
  const gasPrice = asBytes(items[1]);
  const gasLimit = asBytes(items[2]);
  const to = asBytes(items[3]);
  const value = asBytes(items[4]);
  const data = asBytes(items[5]);
  if (!nonce || !gasPrice || !gasLimit || !to || !value || !data) {
    return null;
  }
  const chainId = items.length >= 7 ? asBytes(items[6]) ?? undefined : undefined;
  return { type: 'legacy', nonce, gasPrice, gasLimit, to, value, data, chainId, envelopeHex };
}

function extraNote(request: SigningRequest): string | undefined {
  const lines = request.message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const skip = new Set([request.title.trim(), request.path.trim()]);
  const rest = lines.filter((line) => !skip.has(line) && !/^0x[0-9a-f]+$/i.test(line));
  return rest[0];
}

function chainFromTitle(title: string): string {
  return title
    .replace(/^(Export|Sign|Show)\s+/i, '')
    .replace(/\s+(address|key|public key|hash|message|transaction|wallet ID)$/i, '')
    .trim();
}

function notice(request: SigningRequest, warning: string): SigningDetail {
  const path = request.path.trim();
  const showPath = path.length > 0 && path !== '—' && path !== 'device';
  return {
    style: 'notice',
    headline: request.title,
    warning,
    fields: showPath ? [{ label: 'PATH', value: path, mono: true }] : [],
  };
}

function describeAddress(request: SigningRequest): SigningDetail {
  const chain = chainFromTitle(request.title);
  const fields: SigningField[] = [];
  if (chain) {
    fields.push({ label: 'CHAIN', value: chain });
  }
  if (request.path) {
    fields.push({ label: 'PATH', value: request.path, mono: true });
  }
  return {
    style: 'address',
    headline: request.title,
    fields,
    note: extraNote(request),
  };
}

function describeHash(request: SigningRequest): SigningDetail {
  return {
    style: 'btc-hash',
    headline: request.title,
    fields: [
      { label: 'CHAIN', value: chainFromTitle(request.title) || request.title },
      { label: 'PATH', value: request.path, mono: true },
      { label: 'HASH', value: hex0x(request.rawPayload), mono: true },
    ],
  };
}

function describeBtcMessage(request: SigningRequest): SigningDetail {
  const text = asPrintable(request.rawPayload);
  return {
    style: 'btc-message',
    headline: request.title,
    fields: [
      { label: 'CHAIN', value: chainFromTitle(request.title) || request.title },
      { label: 'PATH', value: request.path, mono: true },
      { label: text ? 'MESSAGE' : 'PAYLOAD', value: text ?? hex0x(request.rawPayload), mono: true },
    ],
    hex: text ? undefined : hex0x(request.rawPayload),
  };
}

/** NEP-413 review. The device adds the off-chain prefix before hashing; the sheet shows the message itself. */
export function describeNearMessage(input: {
  path: string;
  message: string;
  recipient: string;
  nonce: Uint8Array;
  callbackUrl?: string;
}): SigningDetail {
  const fields: SigningField[] = [
    { label: 'CHAIN', value: 'NEAR' },
    { label: 'PATH', value: input.path, mono: true },
    { label: 'MESSAGE', value: input.message },
    { label: 'RECIPIENT', value: input.recipient, mono: true },
    { label: 'NONCE', value: hex0x(input.nonce), mono: true },
  ];
  if (input.callbackUrl !== undefined) {
    fields.push({ label: 'CALLBACK', value: input.callbackUrl, mono: true });
  }
  return {
    style: 'raw-sign',
    headline: 'Sign NEAR message',
    note: 'NEP-413 off-chain message. Nothing is broadcast until an app uses this signature.',
    fields,
  };
}

/** NEP-366 review. Action bytes stay visible as hex because nested actions are not fully decoded. */
export function describeNearDelegate(input: {
  path: string;
  sender: string;
  receiver: string;
  actionCount: number;
  raw: Uint8Array;
}): SigningDetail {
  return {
    style: 'raw-sign',
    headline: 'Sign NEAR delegate action',
    note: 'NEP-366 meta-transaction. Confirm only if the sender, receiver, and payload are expected.',
    fields: [
      { label: 'CHAIN', value: 'NEAR' },
      { label: 'PATH', value: input.path, mono: true },
      { label: 'SENDER', value: input.sender, mono: true },
      { label: 'RECEIVER', value: input.receiver, mono: true },
      { label: 'ACTIONS', value: String(input.actionCount) },
    ],
    hex: hex0x(input.raw),
  };
}

function describeRaw(request: SigningRequest): SigningDetail {
  return {
    style: 'raw-sign',
    headline: request.title,
    fields: [
      { label: 'CHAIN', value: chainFromTitle(request.title) || request.title },
      { label: 'PATH', value: request.path, mono: true },
      { label: 'BYTES', value: String(request.rawPayload.length) },
    ],
    hex: hex0x(request.rawPayload),
    note: extraNote(request),
  };
}

function isEthTxTitle(title: string): boolean {
  return /ethereum transaction/i.test(title) || /^sign transaction$/i.test(title);
}

function isBtcFamily(title: string): boolean {
  return /bitcoin|litecoin|dogecoin/i.test(title);
}

function describeSign(request: SigningRequest): SigningDetail {
  const title = request.title;
  if (isEthTxTitle(title)) {
    const parsed = parseEthTx(request.rawPayload);
    if (!parsed) {
      return {
        style: 'eth-tx',
        headline: 'Unable to decode transaction',
        decodeFailed: true,
        fields: request.path ? [{ label: 'PATH', value: request.path, mono: true }] : [],
        hex: hex0x(request.rawPayload),
      };
    }
    return describeEthTransaction({ ...parsed, path: request.path });
  }
  if (isBtcFamily(title) && /hash/i.test(title)) {
    return describeHash(request);
  }
  if (isBtcFamily(title) && /message/i.test(title)) {
    return describeBtcMessage(request);
  }
  if (/hash/i.test(title) && request.rawPayload.length === 32) {
    return describeHash(request);
  }
  if (/^sign message$/i.test(title) || /personal/i.test(title)) {
    return describeEthMessage(request.path, request.rawPayload);
  }
  return describeRaw(request);
}

export function describeSigning(request: SigningRequest): SigningDetail {
  if (request.detail) {
    return request.detail;
  }
  switch (request.kind) {
    case 'open-app':
      return notice(request, 'Opening this app lets the host send further commands for that app.');
    case 'allow-manager':
      return notice(request, 'Manager access can list, install, or remove apps on this device.');
    case 'pairing':
      return notice(request, 'Pairing binds this host to the device session.');
    case 'verify':
      return notice(request, 'The host is checking that this device is genuine.');
    case 'address':
      return describeAddress(request);
    case 'export-seed':
      return notice(request, request.message);
    default:
      return describeSign(request);
  }
}
