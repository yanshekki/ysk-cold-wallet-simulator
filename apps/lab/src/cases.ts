import { componentsToPath, pathToComponents } from '@cws/contracts';
import {
  FUJI_C_CHAIN_ID,
  FUJI_HRP,
  FUJI_X_CHAIN_ID,
  buildP2wpkhPsbt,
  ledgerFlowFromPsbt,
  u32le,
} from '@cws/protocol-ledger';
import {
  MessageType as OneKeyMessageType,
  decodeBitcoinAddress,
  decodeEthereumAddress,
  decodeEthereumMessageSignature,
  encodeBool,
  encodeBytes,
  encodeRepeatedUint32,
  encodeString,
  encodeUint32,
} from '@cws/protocol-onekey';
import {
  MessageType as TrezorMessageType,
  decodeEthereumAddress as decodeTrezorAddress,
  decodeEthereumMessageSignature as decodeTrezorMessageSignature,
  encodeBytes as trezorEncodeBytes,
  encodeMessage as trezorEncodeMessage,
  encodeRepeatedUint32 as trezorEncodeRepeatedUint32,
  encodeString as trezorEncodeString,
  encodeUint32 as trezorEncodeUint32,
} from '@cws/protocol-trezor';
import {
  PATH_ADA,
  PATH_APT,
  PATH_ATOM,
  PATH_AVAX,
  PATH_BTC,
  PATH_DOGE,
  PATH_DOT,
  PATH_ETH,
  PATH_LTC,
  PATH_NEAR,
  PATH_SOL,
  PATH_SUI,
  PATH_TON,
  PATH_TRX,
  PATH_XRP,
  assertOk,
  bytesToHex,
  concatBytes,
  decodePubAndAddress,
  encodeNearPath,
  encodePath,
  hexToBytes,
} from './apdu';
import type { LabHost } from './host';
import { NEAR_FAUCET, broadcastSepolia, nearViewAccount, solanaDevnetHealth } from './rpc';
import { eip1559EthTx, eip1559Signed, eip2930EthTx, garbageEthTx, legacyEthTx } from './rlp';

export type LabDraft = {
  path: string;
  utf8: string;
  hex: string;
};

export type LabEditor = {
  path?: string;
  utf8?: string;
  hex?: string;
};

export type LabAction = {
  id: string;
  brand: 'ledger' | 'onekey' | 'trezor';
  section: string;
  en: string;
  zh: string;
  noteEn?: string;
  noteZh?: string;
  editor?: LabEditor;
  run: (host: LabHost, draft: LabDraft) => Promise<string>;
};

function pathString(components: number[]): string {
  return componentsToPath(components);
}

function pathOf(draft: LabDraft, fallback: number[]): number[] {
  const raw = draft.path.trim();
  if (!raw) {
    return fallback;
  }
  return pathToComponents(raw);
}

function payloadOf(draft: LabDraft, fallback: Uint8Array): Uint8Array {
  const hex = draft.hex.trim();
  if (hex) {
    return hexToBytes(hex.startsWith('0x') || hex.startsWith('0X') ? hex : `0x${hex}`);
  }
  if (draft.utf8.length > 0) {
    return new TextEncoder().encode(draft.utf8);
  }
  return fallback;
}

function describeKey(body: Uint8Array): string {
  const decoded = decodePubAndAddress(body);
  if (decoded.address) {
    return `${decoded.address}  pub=${decoded.pub.slice(0, 16)}…`;
  }
  if (decoded.pub) {
    return `0x${decoded.pub}`;
  }
  return `0x${bytesToHex(body)}`;
}

function addressN(path: number[]): number[] {
  return path;
}

function avaxAddrData(hrp: string, chainId: Uint8Array, path: number[]): Uint8Array {
  const hrpBytes = new TextEncoder().encode(hrp);
  return concatBytes(
    Uint8Array.of(hrpBytes.length),
    hrpBytes,
    Uint8Array.of(chainId.length),
    chainId,
    encodePath(path),
  );
}

async function familyExport(
  host: LabHost,
  app: string,
  cla: number,
  ins: number,
  path: number[],
): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp(app);
  const body = await tx.sendOk(cla, ins, 0x01, 0x00, encodePath(path), `${app} pubkey`);
  return describeKey(body);
}

async function familySign(
  host: LabHost,
  app: string,
  cla: number,
  ins: number,
  path: number[],
  payload: Uint8Array,
): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp(app);
  const body = await tx.sendOk(cla, ins, 0x00, 0x00, concatBytes(encodePath(path), payload), `${app} sign`);
  return `sig 0x${bytesToHex(body)}`;
}

const LEDGER: LabAction[] = [
  {
    id: 'dash-version',
    brand: 'ledger',
    section: 'dashboard',
    en: 'GET_VERSION',
    zh: '讀取版本',
    run: async (host) => {
      const body = await host.requireLedger().sendOk(0xe0, 0x01, 0x00, 0x00, new Uint8Array(), 'GET_VERSION');
      return `0x${bytesToHex(body)}`;
    },
  },
  {
    id: 'dash-open-eth',
    brand: 'ledger',
    section: 'dashboard',
    en: 'OPEN_APP',
    zh: '開啟 App',
    editor: { utf8: 'Ethereum' },
    run: async (host, draft) => {
      const name = draft.utf8.trim() || 'Ethereum';
      await host.requireLedger().openApp(name, true);
      return `${name} open`;
    },
  },
  {
    id: 'dash-manager',
    brand: 'ledger',
    section: 'dashboard',
    en: 'Allow Manager (E0 12)',
    zh: '允許 Manager',
    run: async (host) => {
      const tx = host.requireLedger();
      await tx.quitApp();
      await tx.sendOk(0xe0, 0x12, 0x00, 0x00, new Uint8Array(), 'ALLOW_MANAGER');
      return 'manager allowed';
    },
  },
  {
    id: 'eth-addr',
    brand: 'ledger',
    section: 'ethereum',
    en: 'GET_ADDRESS',
    zh: '匯出地址',
    editor: { path: pathString(PATH_ETH) },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('Ethereum');
      return describeKey(await tx.sendOk(0xe0, 0x02, 0x01, 0x00, encodePath(pathOf(draft, PATH_ETH)), 'GET_ADDRESS'));
    },
  },
  {
    id: 'eth-personal',
    brand: 'ledger',
    section: 'ethereum',
    en: 'personal_sign UTF-8',
    zh: '簽署文字訊息',
    editor: { path: pathString(PATH_ETH), utf8: 'hello from lab' },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('Ethereum');
      const message = payloadOf(draft, new TextEncoder().encode('hello from lab'));
      const prefix = concatBytes(encodePath(pathOf(draft, PATH_ETH)), Uint8Array.of(0, 0, 0, message.length), message);
      const body = await tx.sendOk(0xe0, 0x08, 0x00, 0x00, prefix, 'PERSONAL_SIGN');
      return `sig 0x${bytesToHex(body)}`;
    },
  },
  {
    id: 'eth-personal-bin',
    brand: 'ledger',
    section: 'ethereum',
    en: 'personal_sign binary',
    zh: '簽署二元訊息',
    editor: { path: pathString(PATH_ETH), hex: '00ff10807f' },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('Ethereum');
      const message = payloadOf(draft, Uint8Array.of(0x00, 0xff, 0x10, 0x80, 0x7f));
      const prefix = concatBytes(encodePath(pathOf(draft, PATH_ETH)), Uint8Array.of(0, 0, 0, message.length), message);
      const body = await tx.sendOk(0xe0, 0x08, 0x00, 0x00, prefix, 'PERSONAL_SIGN');
      return `sig 0x${bytesToHex(body)}`;
    },
  },
  {
    id: 'eth-legacy',
    brand: 'ledger',
    section: 'ethereum',
    en: 'SIGN_TX legacy',
    zh: '簽署 legacy 交易',
    editor: { path: pathString(PATH_ETH), hex: bytesToHex(legacyEthTx()) },
    run: (host, draft) =>
      signEthTx(host, payloadOf(draft, legacyEthTx()), pathOf(draft, PATH_ETH), 'SIGN_TX legacy'),
  },
  {
    id: 'eth-2930',
    brand: 'ledger',
    section: 'ethereum',
    en: 'SIGN_TX EIP-2930',
    zh: '簽署 EIP-2930',
    editor: { path: pathString(PATH_ETH), hex: bytesToHex(eip2930EthTx()) },
    run: (host, draft) => signEthTx(host, payloadOf(draft, eip2930EthTx()), pathOf(draft, PATH_ETH), 'SIGN_TX 2930'),
  },
  {
    id: 'eth-1559',
    brand: 'ledger',
    section: 'ethereum',
    en: 'SIGN_TX EIP-1559',
    zh: '簽署 EIP-1559',
    editor: { path: pathString(PATH_ETH), hex: bytesToHex(eip1559EthTx()) },
    run: (host, draft) => signEthTx(host, payloadOf(draft, eip1559EthTx()), pathOf(draft, PATH_ETH), 'SIGN_TX 1559'),
  },
  {
    id: 'eth-garbage',
    brand: 'ledger',
    section: 'ethereum',
    en: 'SIGN_TX undecodable (EIP-4844 envelope)',
    zh: '簽署無法解碼交易',
    noteEn: 'Complete 0x03 RLP. Phone shows decode-failed; page still gets 9000.',
    noteZh: '完整 0x03 RLP。電話顯示無法解碼，網頁仍會收到 9000。',
    editor: { path: pathString(PATH_ETH), hex: bytesToHex(garbageEthTx()) },
    run: (host, draft) => signEthTx(host, payloadOf(draft, garbageEthTx()), pathOf(draft, PATH_ETH), 'SIGN_TX garbage'),
  },
  {
    id: 'eth-712',
    brand: 'ledger',
    section: 'ethereum',
    en: 'EIP-712 hashed typed data',
    zh: 'EIP-712 雜湊類型資料',
    editor: {
      path: pathString(PATH_ETH),
      hex: `${'11'.repeat(32)}${'22'.repeat(32)}`,
    },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('Ethereum');
      const hashes = payloadOf(draft, hexToBytes(`0x${'11'.repeat(32)}${'22'.repeat(32)}`));
      const body = await tx.sendOk(
        0xe0,
        0x0c,
        0x00,
        0x00,
        concatBytes(encodePath(pathOf(draft, PATH_ETH)), hashes.subarray(0, 64)),
        'EIP-712',
      );
      return `sig 0x${bytesToHex(body)}`;
    },
  },
  {
    id: 'eth-broadcast',
    brand: 'ledger',
    section: 'ethereum',
    en: 'Sign EIP-1559 + broadcast',
    zh: '簽署 EIP-1559 並廣播',
    editor: { path: pathString(PATH_ETH), hex: bytesToHex(eip1559EthTx()) },
    run: async (host, draft) => {
      const rawSig = await signEthTxBytes(
        host,
        payloadOf(draft, eip1559EthTx()),
        pathOf(draft, PATH_ETH),
        'SIGN_TX 1559',
      );
      try {
        const hash = await broadcastSepolia(eip1559Signed(rawSig));
        return `sig 0x${bytesToHex(rawSig)}  broadcast=${hash}`;
      } catch (error) {
        return `sig 0x${bytesToHex(rawSig)}  broadcast failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  {
    id: 'sol-addr',
    brand: 'ledger',
    section: 'solana',
    en: 'GET_PUBKEY',
    zh: '匯出公鑰',
    editor: { path: pathString(PATH_SOL) },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('Solana');
      const body = await tx.sendOk(0xe0, 0x05, 0x01, 0x00, encodePath(pathOf(draft, PATH_SOL)), 'SOL pubkey');
      return describeKey(body);
    },
  },
  {
    id: 'sol-sign',
    brand: 'ledger',
    section: 'solana',
    en: 'Sign two-chunk (MORE then last)',
    zh: '分段簽署',
    editor: { path: pathString(PATH_SOL), hex: '1122334455667788' },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('Solana');
      const path = encodePath(pathOf(draft, PATH_SOL));
      const payload = payloadOf(draft, Uint8Array.of(0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88));
      const split = Math.min(4, payload.length);
      const more = await tx.send(0xe0, 0x06, 0x01, 0x02, concatBytes(path, payload.subarray(0, split)));
      assertOk(more, 'SOL MORE');
      if (more.length !== 2) {
        throw new Error(`expected empty 9000, got ${more.length} bytes`);
      }
      const done = await tx.sendOk(0xe0, 0x06, 0x01, 0x00, payload.subarray(split), 'SOL sign last');
      void solanaDevnetHealth().catch(() => undefined);
      return `sig 0x${bytesToHex(done)}`;
    },
  },
  {
    id: 'sol-sign-07',
    brand: 'ledger',
    section: 'solana',
    en: 'Sign INS 07',
    zh: 'INS 07 簽署',
    editor: { path: pathString(PATH_SOL), hex: 'deadbeefcafebabe' },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('Solana');
      const body = await tx.sendOk(
        0xe0,
        0x07,
        0x00,
        0x00,
        concatBytes(encodePath(pathOf(draft, PATH_SOL)), payloadOf(draft, hexToBytes('0xdeadbeefcafebabe'))),
        'SOL INS 07',
      );
      return `sig 0x${bytesToHex(body)}`;
    },
  },
  {
    id: 'near-addr',
    brand: 'ledger',
    section: 'near',
    en: 'GET_PUBLIC_KEY (display)',
    zh: '匯出公鑰',
    editor: { path: pathString(PATH_NEAR) },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('NEAR');
      const body = await tx.sendOk(0x80, 0x04, 0x00, 0x00, encodeNearPath(pathOf(draft, PATH_NEAR)), 'NEAR pubkey');
      const account = bytesToHex(body);
      let chain = '';
      try {
        chain = await nearViewAccount(account);
      } catch (error) {
        chain = error instanceof Error ? error.message : 'missing on testnet';
      }
      return `implicit ${account}  ${chain}  faucet ${NEAR_FAUCET}`;
    },
  },
  {
    id: 'near-sign',
    brand: 'ledger',
    section: 'near',
    en: 'SIGN_TRANSACTION',
    zh: '簽署交易',
    editor: { path: pathString(PATH_NEAR), hex: '01020304' },
    run: async (host, draft) => {
      const tx = host.requireLedger();
      await tx.openApp('NEAR');
      const payload = concatBytes(encodeNearPath(pathOf(draft, PATH_NEAR)), payloadOf(draft, hexToBytes('0x01020304')));
      const body = await tx.sendOk(0x80, 0x02, 0x80, 0x00, payload, 'NEAR sign');
      return `sig 0x${bytesToHex(body)}`;
    },
  },
  ...btcFamily(),
  ...avalancheFamily(),
  ...otherFamilies(),
];

function btcFamily(): LabAction[] {
  const hash = new Uint8Array(32).fill(0x11);
  return [
    {
      id: 'btc-addr',
      brand: 'ledger',
      section: 'bitcoin',
      en: 'Bitcoin export key',
      zh: 'Bitcoin 匯出金鑰',
      editor: { path: pathString(PATH_BTC) },
      run: (host, draft) => btcExport(host, 'Bitcoin', pathOf(draft, PATH_BTC)),
    },
    {
      id: 'btc-hash',
      brand: 'ledger',
      section: 'bitcoin',
      en: 'Bitcoin sign hash',
      zh: 'Bitcoin 簽署雜湊',
      editor: { path: pathString(PATH_BTC), hex: bytesToHex(hash) },
      run: (host, draft) => btcHash(host, 'Bitcoin', pathOf(draft, PATH_BTC), payloadOf(draft, hash)),
    },
    {
      id: 'btc-msg',
      brand: 'ledger',
      section: 'bitcoin',
      en: 'Bitcoin sign message',
      zh: 'Bitcoin 簽署訊息',
      editor: { path: pathString(PATH_BTC), utf8: 'hello btc' },
      run: (host, draft) =>
        btcMessage(host, 'Bitcoin', pathOf(draft, PATH_BTC), payloadOf(draft, new TextEncoder().encode('hello btc'))),
    },
    {
      id: 'btc-psbt',
      brand: 'ledger',
      section: 'bitcoin',
      en: 'Bitcoin PSBT',
      zh: 'Bitcoin PSBT',
      editor: { path: pathString(PATH_BTC), hex: bytesToHex(samplePsbt()) },
      run: (host, draft) => btcPsbt(host, pathOf(draft, PATH_BTC), payloadOf(draft, samplePsbt())),
    },
    {
      id: 'ltc-hash',
      brand: 'ledger',
      section: 'bitcoin',
      en: 'Litecoin sign hash',
      zh: 'Litecoin 簽署雜湊',
      editor: { path: pathString(PATH_LTC), hex: bytesToHex(hash) },
      run: (host, draft) => btcHash(host, 'Litecoin', pathOf(draft, PATH_LTC), payloadOf(draft, hash)),
    },
    {
      id: 'doge-msg',
      brand: 'ledger',
      section: 'bitcoin',
      en: 'Dogecoin sign message',
      zh: 'Dogecoin 簽署訊息',
      editor: { path: pathString(PATH_DOGE), utf8: 'wow' },
      run: (host, draft) =>
        btcMessage(host, 'Dogecoin', pathOf(draft, PATH_DOGE), payloadOf(draft, new TextEncoder().encode('wow'))),
    },
  ];
}

function avalancheFamily(): LabAction[] {
  const hash = new Uint8Array(32).fill(0x22);
  const msg = new TextEncoder().encode('fuji lab');
  return [
    {
      id: 'avax-wallet-id',
      brand: 'ledger',
      section: 'avalanche',
      en: 'WALLET_ID (show)',
      zh: '顯示錢包 ID',
      run: async (host) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const body = await tx.sendOk(0x80, 0x01, 0x01, 0x00, new Uint8Array(), 'AVAX WALLET_ID');
        return `0x${bytesToHex(body)}`;
      },
    },
    {
      id: 'avax-p-addr',
      brand: 'ledger',
      section: 'avalanche',
      en: 'P-Chain GET_ADDR (show, fuji)',
      zh: 'P-Chain 匯出地址',
      editor: { path: pathString(PATH_AVAX) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const data = avaxAddrData(FUJI_HRP, new Uint8Array(), pathOf(draft, PATH_AVAX));
        return describeKey(await tx.sendOk(0x80, 0x02, 0x01, 0x00, data, 'AVAX P GET_ADDR'));
      },
    },
    {
      id: 'avax-p-xpub',
      brand: 'ledger',
      section: 'avalanche',
      en: 'P-Chain GET_XPUB',
      zh: 'P-Chain 匯出 xpub',
      editor: { path: pathString(PATH_AVAX) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const data = avaxAddrData(FUJI_HRP, new Uint8Array(), pathOf(draft, PATH_AVAX));
        const body = await tx.sendOk(0x80, 0x03, 0x01, 0x00, data, 'AVAX P GET_XPUB');
        return `0x${bytesToHex(body)}`;
      },
    },
    {
      id: 'avax-p-hash',
      brand: 'ledger',
      section: 'avalanche',
      en: 'P-Chain SIGN_HASH',
      zh: 'P-Chain 簽署雜湊',
      editor: { path: pathString(PATH_AVAX), hex: bytesToHex(hash) },
      run: (host, draft) => avaxSignHash(host, pathOf(draft, PATH_AVAX), payloadOf(draft, hash), 0x00),
    },
    {
      id: 'avax-p-sign',
      brand: 'ledger',
      section: 'avalanche',
      en: 'P-Chain SIGN',
      zh: 'P-Chain 簽署',
      noteEn: 'Raw payload sign, not a full P-Chain tx parser.',
      noteZh: '原始負載簽署，不是完整 P-Chain 交易解析。',
      editor: { path: pathString(PATH_AVAX), hex: 'cafebabe' },
      run: (host, draft) => avaxSignPayload(host, 0x05, pathOf(draft, PATH_AVAX), payloadOf(draft, hexToBytes('0xcafebabe'))),
    },
    {
      id: 'avax-p-msg',
      brand: 'ledger',
      section: 'avalanche',
      en: 'P-Chain SIGN_MSG',
      zh: 'P-Chain 簽署訊息',
      editor: { path: pathString(PATH_AVAX), utf8: 'fuji lab' },
      run: (host, draft) => avaxSignPayload(host, 0x06, pathOf(draft, PATH_AVAX), payloadOf(draft, msg)),
    },
    {
      id: 'avax-p-hash-ed25519',
      brand: 'ledger',
      section: 'avalanche',
      en: 'P-Chain SIGN_HASH ed25519',
      zh: 'P-Chain ed25519 雜湊',
      editor: { path: pathString(PATH_AVAX), hex: bytesToHex(hash) },
      run: (host, draft) => avaxSignHash(host, pathOf(draft, PATH_AVAX), payloadOf(draft, hash), 0x01),
    },
    {
      id: 'avax-p-ed25519',
      brand: 'ledger',
      section: 'avalanche',
      en: 'P-Chain GET_ADDR ed25519',
      zh: 'P-Chain ed25519 地址',
      editor: { path: pathString(PATH_AVAX) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const body = await tx.sendOk(
          0x80,
          0x02,
          0x01,
          0x01,
          encodePath(pathOf(draft, PATH_AVAX)),
          'AVAX P GET_ADDR ed25519',
        );
        return describeKey(body);
      },
    },
    {
      id: 'avax-x-addr',
      brand: 'ledger',
      section: 'avalanche',
      en: 'X-Chain GET_ADDR (show, fuji)',
      zh: 'X-Chain 匯出地址',
      editor: { path: pathString(PATH_AVAX) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const data = avaxAddrData(FUJI_HRP, FUJI_X_CHAIN_ID, pathOf(draft, PATH_AVAX));
        return describeKey(await tx.sendOk(0x80, 0x02, 0x01, 0x00, data, 'AVAX X GET_ADDR'));
      },
    },
    {
      id: 'avax-x-xpub',
      brand: 'ledger',
      section: 'avalanche',
      en: 'X-Chain GET_XPUB',
      zh: 'X-Chain 匯出 xpub',
      editor: { path: pathString(PATH_AVAX) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const data = avaxAddrData(FUJI_HRP, FUJI_X_CHAIN_ID, pathOf(draft, PATH_AVAX));
        return `0x${bytesToHex(await tx.sendOk(0x80, 0x03, 0x01, 0x00, data, 'AVAX X GET_XPUB'))}`;
      },
    },
    {
      id: 'avax-x-hash',
      brand: 'ledger',
      section: 'avalanche',
      en: 'X-Chain SIGN_HASH',
      zh: 'X-Chain 簽署雜湊',
      editor: { path: pathString(PATH_AVAX), hex: bytesToHex(hash) },
      run: (host, draft) => avaxSignHash(host, pathOf(draft, PATH_AVAX), payloadOf(draft, hash), 0x00),
    },
    {
      id: 'avax-x-sign',
      brand: 'ledger',
      section: 'avalanche',
      en: 'X-Chain SIGN',
      zh: 'X-Chain 簽署',
      noteEn: 'Raw payload sign, not a full X-Chain tx parser.',
      noteZh: '原始負載簽署，不是完整 X-Chain 交易解析。',
      editor: { path: pathString(PATH_AVAX), hex: 'cafebabe' },
      run: (host, draft) => avaxSignPayload(host, 0x05, pathOf(draft, PATH_AVAX), payloadOf(draft, hexToBytes('0xcafebabe'))),
    },
    {
      id: 'avax-x-msg',
      brand: 'ledger',
      section: 'avalanche',
      en: 'X-Chain SIGN_MSG',
      zh: 'X-Chain 簽署訊息',
      editor: { path: pathString(PATH_AVAX), utf8: 'fuji lab' },
      run: (host, draft) => avaxSignPayload(host, 0x06, pathOf(draft, PATH_AVAX), payloadOf(draft, msg)),
    },
    {
      id: 'avax-c-eth-addr',
      brand: 'ledger',
      section: 'avalanche',
      en: 'C-Chain GET_ADDRESS (CLA E0)',
      zh: 'C-Chain 匯出地址',
      editor: { path: pathString(PATH_ETH) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        return describeKey(
          await tx.sendOk(0xe0, 0x02, 0x01, 0x00, encodePath(pathOf(draft, PATH_ETH)), 'AVAX C GET_ADDRESS'),
        );
      },
    },
    {
      id: 'avax-c-personal',
      brand: 'ledger',
      section: 'avalanche',
      en: 'C-Chain personal_sign',
      zh: 'C-Chain 簽署訊息',
      editor: { path: pathString(PATH_ETH), utf8: 'hello fuji' },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const message = payloadOf(draft, new TextEncoder().encode('hello fuji'));
        const prefix = concatBytes(encodePath(pathOf(draft, PATH_ETH)), Uint8Array.of(0, 0, 0, message.length), message);
        return `sig 0x${bytesToHex(await tx.sendOk(0xe0, 0x08, 0x00, 0x00, prefix, 'AVAX C PERSONAL_SIGN'))}`;
      },
    },
    {
      id: 'avax-c-tx',
      brand: 'ledger',
      section: 'avalanche',
      en: 'C-Chain SIGN_TX',
      zh: 'C-Chain 簽署交易',
      editor: { path: pathString(PATH_ETH), hex: bytesToHex(eip1559EthTx()) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        return signEthTx(host, payloadOf(draft, eip1559EthTx()), pathOf(draft, PATH_ETH), 'AVAX C SIGN_TX', 'Avalanche');
      },
    },
    {
      id: 'avax-c-native-addr',
      brand: 'ledger',
      section: 'avalanche',
      en: 'C-Chain native GET_ADDR',
      zh: 'C-Chain 原生地址',
      editor: { path: pathString(PATH_AVAX) },
      run: async (host, draft) => {
        const tx = host.requireLedger();
        await tx.openApp('Avalanche');
        const data = avaxAddrData(FUJI_HRP, FUJI_C_CHAIN_ID, pathOf(draft, PATH_AVAX));
        return describeKey(await tx.sendOk(0x80, 0x02, 0x01, 0x00, data, 'AVAX C native GET_ADDR'));
      },
    },
  ];
}

function otherFamilies(): LabAction[] {
  const raw = hexToBytes('0xdeadbeefcafebabe');
  const rows: Array<{
    id: string;
    app: string;
    cla: number;
    pub: number;
    sign: number;
    path: number[];
    addrEn: string;
    addrZh: string;
    signEn: string;
    signZh: string;
  }> = [
    {
      id: 'ada',
      app: 'Cardano',
      cla: 0xd7,
      pub: 0x11,
      sign: 0x21,
      path: PATH_ADA,
      addrEn: 'Cardano export address',
      addrZh: 'Cardano 匯出地址',
      signEn: 'Cardano sign (raw)',
      signZh: 'Cardano 簽署（原始）',
    },
    {
      id: 'xrp',
      app: 'XRP',
      cla: 0xe0,
      pub: 0x02,
      sign: 0x04,
      path: PATH_XRP,
      addrEn: 'XRP export key',
      addrZh: 'XRP 匯出金鑰',
      signEn: 'XRP sign (raw)',
      signZh: 'XRP 簽署（原始）',
    },
    {
      id: 'trx',
      app: 'Tron',
      cla: 0xe0,
      pub: 0x02,
      sign: 0x04,
      path: PATH_TRX,
      addrEn: 'Tron export key',
      addrZh: 'Tron 匯出金鑰',
      signEn: 'Tron sign (raw)',
      signZh: 'Tron 簽署（原始）',
    },
    {
      id: 'atom',
      app: 'Cosmos',
      cla: 0x55,
      pub: 0x04,
      sign: 0x02,
      path: PATH_ATOM,
      addrEn: 'Cosmos export key',
      addrZh: 'Cosmos 匯出金鑰',
      signEn: 'Cosmos sign (raw)',
      signZh: 'Cosmos 簽署（原始）',
    },
    {
      id: 'ton',
      app: 'TON',
      cla: 0xe0,
      pub: 0x02,
      sign: 0x06,
      path: PATH_TON,
      addrEn: 'TON export key',
      addrZh: 'TON 匯出金鑰',
      signEn: 'TON sign (raw)',
      signZh: 'TON 簽署（原始）',
    },
    {
      id: 'apt',
      app: 'Aptos',
      cla: 0x5b,
      pub: 0x05,
      sign: 0x0a,
      path: PATH_APT,
      addrEn: 'Aptos export key',
      addrZh: 'Aptos 匯出金鑰',
      signEn: 'Aptos sign (raw)',
      signZh: 'Aptos 簽署（原始）',
    },
    {
      id: 'sui',
      app: 'Sui',
      cla: 0x00,
      pub: 0x01,
      sign: 0x02,
      path: PATH_SUI,
      addrEn: 'Sui export key',
      addrZh: 'Sui 匯出金鑰',
      signEn: 'Sui sign (raw)',
      signZh: 'Sui 簽署（原始）',
    },
    {
      id: 'dot',
      app: 'Polkadot',
      cla: 0xf9,
      pub: 0x01,
      sign: 0x02,
      path: PATH_DOT,
      addrEn: 'Polkadot export key',
      addrZh: 'Polkadot 匯出金鑰',
      signEn: 'Polkadot sign (raw)',
      signZh: 'Polkadot 簽署（原始）',
    },
  ];
  const actions: LabAction[] = [];
  for (const row of rows) {
    actions.push({
      id: `${row.id}-addr`,
      brand: 'ledger',
      section: 'family',
      en: row.addrEn,
      zh: row.addrZh,
      editor: { path: pathString(row.path) },
      run: (host, draft) => familyExport(host, row.app, row.cla, row.pub, pathOf(draft, row.path)),
    });
    actions.push({
      id: `${row.id}-sign`,
      brand: 'ledger',
      section: 'family',
      en: row.signEn,
      zh: row.signZh,
      noteEn: 'One-chunk raw sign. Not a full transaction body parser.',
      noteZh: '單段原始簽署。不是完整交易主體解析。',
      editor: { path: pathString(row.path), hex: bytesToHex(raw) },
      run: (host, draft) => familySign(host, row.app, row.cla, row.sign, pathOf(draft, row.path), payloadOf(draft, raw)),
    });
  }
  return actions;
}

function samplePsbt(): Uint8Array {
  return buildP2wpkhPsbt({
    prevTxId: new Uint8Array(32).fill(0x11),
    prevIndex: 0,
    amount: 10000n,
    scriptPubKey: concatBytes(Uint8Array.of(0x00, 0x14), new Uint8Array(20).fill(0x22)),
    outputs: [{ amount: 8000n, script: concatBytes(Uint8Array.of(0x00, 0x14), new Uint8Array(20).fill(0x33)) }],
  });
}

async function btcPsbt(host: LabHost, path: number[], psbt: Uint8Array): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp('Bitcoin');
  const flow = ledgerFlowFromPsbt(psbt);
  await tx.sendOk(0xe0, 0x44, 0x00, 0x02, flow.start, 'PSBT 0x44');
  await tx.sendOk(0xe0, 0x4a, 0x00, 0x00, flow.outputs, 'PSBT 0x4A');
  const body = await tx.sendOk(
    0xe0,
    0x48,
    0x00,
    0x00,
    concatBytes(encodePath(path), u32le(flow.locktime)),
    'PSBT 0x48',
  );
  return `der 0x${bytesToHex(body)}`;
}

function protoPath(encodeRep: typeof encodeRepeatedUint32, path: number[], extra?: Uint8Array): Uint8Array {
  return extra ? concatBytes(encodeRep(1, path), extra) : encodeRep(1, path);
}

function okCall(
  type: number,
  path: number[],
  extra?: Uint8Array,
): (host: LabHost, draft: LabDraft) => Promise<string> {
  return async (host, draft) => {
    const payload = protoPath(encodeRepeatedUint32, pathOf(draft, path), extra);
    const reply = await host.requireOneKey().call(type, payload);
    return `type=${reply.type} 0x${bytesToHex(reply.payload).slice(0, 96)}`;
  };
}

function okSign(
  type: number,
  path: number[],
  fallback: Uint8Array,
): (host: LabHost, draft: LabDraft) => Promise<string> {
  return async (host, draft) => {
    const message = payloadOf(draft, fallback);
    const payload = concatBytes(encodeRepeatedUint32(1, pathOf(draft, path)), encodeBytes(2, message));
    const reply = await host.requireOneKey().call(type, payload);
    return `type=${reply.type} 0x${bytesToHex(reply.payload).slice(0, 96)}`;
  };
}

const ONEKEY: LabAction[] = [
  {
    id: 'ok-features',
    brand: 'onekey',
    section: 'onekey',
    en: 'Initialize / Features',
    zh: 'Initialize / Features',
    run: async (host) => {
      const reply = await host.requireOneKey().call(OneKeyMessageType.Initialize, new Uint8Array());
      return `Features type=${reply.type} ${bytesToHex(reply.payload).slice(0, 32)}…`;
    },
  },
  {
    id: 'ok-se-sign',
    brand: 'onekey',
    section: 'onekey',
    en: 'SESignMessage',
    zh: '裝置驗證簽署',
    editor: { hex: 'cafef00d' },
    run: async (host, draft) => {
      const challenge = payloadOf(draft, hexToBytes('0xcafef00d'));
      const reply = await host.requireOneKey().call(OneKeyMessageType.SESignMessage, encodeBytes(1, challenge));
      return `sig 0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'ok-eth-addr',
    brand: 'onekey',
    section: 'ethereum',
    en: 'ETH GetAddress',
    zh: 'ETH 匯出地址',
    editor: { path: pathString(PATH_ETH) },
    run: async (host, draft) => {
      const payload = concatBytes(encodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))), encodeUint32(2, 1));
      const reply = await host.requireOneKey().call(OneKeyMessageType.EthereumGetAddress, payload);
      return decodeEthereumAddress(reply.payload) || `0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'ok-eth-msg',
    brand: 'onekey',
    section: 'ethereum',
    en: 'ETH SignMessage',
    zh: 'ETH 簽署訊息',
    editor: { path: pathString(PATH_ETH), utf8: 'hello onekey' },
    run: async (host, draft) => {
      const message = payloadOf(draft, new TextEncoder().encode('hello onekey'));
      const payload = concatBytes(encodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))), encodeBytes(2, message));
      const reply = await host.requireOneKey().call(OneKeyMessageType.EthereumSignMessage, payload);
      const decoded = decodeEthereumMessageSignature(reply.payload);
      return `${decoded.address}  sig 0x${bytesToHex(decoded.signature)}`;
    },
  },
  {
    id: 'ok-eth-tx',
    brand: 'onekey',
    section: 'ethereum',
    en: 'ETH SignTx (legacy)',
    zh: 'ETH 簽署交易',
    editor: { path: pathString(PATH_ETH), hex: '1111111111111111111111111111111111111111' },
    run: async (host, draft) => {
      const to = payloadOf(draft, hexToBytes('0x1111111111111111111111111111111111111111'));
      const payload = concatBytes(
        encodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        encodeBytes(2, new Uint8Array()),
        encodeBytes(3, hexToBytes('0x3b9aca00')),
        encodeBytes(4, hexToBytes('0x5208')),
        encodeBytes(5, to),
        encodeBytes(6, new Uint8Array()),
        encodeBytes(7, new Uint8Array()),
        encodeUint32(11, 11155111),
      );
      const reply = await host.requireOneKey().call(OneKeyMessageType.EthereumSignTx, payload);
      return `tx request 0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'ok-eth-1559',
    brand: 'onekey',
    section: 'ethereum',
    en: 'ETH SignTx EIP-1559',
    zh: 'ETH 簽署 EIP-1559',
    editor: { path: pathString(PATH_ETH), hex: '1111111111111111111111111111111111111111' },
    run: async (host, draft) => {
      const to = payloadOf(draft, hexToBytes('0x1111111111111111111111111111111111111111'));
      const payload = concatBytes(
        encodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        encodeBytes(2, new Uint8Array()),
        encodeBytes(3, hexToBytes('0x3b9aca00')),
        encodeBytes(4, hexToBytes('0x77359400')),
        encodeBytes(5, hexToBytes('0x5208')),
        encodeString(6, `0x${bytesToHex(to)}`),
        encodeBytes(7, new Uint8Array()),
        encodeBytes(8, new Uint8Array()),
        encodeUint32(10, 11155111),
      );
      const reply = await host.requireOneKey().call(OneKeyMessageType.EthereumSignTxEIP1559, payload);
      return `tx request 0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'ok-eth-712',
    brand: 'onekey',
    section: 'ethereum',
    en: 'ETH SignTypedHash',
    zh: 'ETH 簽署類型雜湊',
    editor: { path: pathString(PATH_ETH), hex: `${'11'.repeat(32)}${'22'.repeat(32)}` },
    run: async (host, draft) => {
      const hashes = payloadOf(draft, hexToBytes(`0x${'11'.repeat(32)}${'22'.repeat(32)}`));
      const payload = concatBytes(
        encodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        encodeBytes(2, hashes.subarray(0, 32)),
        encodeBytes(3, hashes.subarray(32, 64)),
      );
      const reply = await host.requireOneKey().call(OneKeyMessageType.EthereumSignTypedHash, payload);
      return `sig 0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'ok-btc-addr',
    brand: 'onekey',
    section: 'bitcoin',
    en: 'BTC GetAddress (show)',
    zh: 'BTC 顯示地址',
    editor: { path: pathString(PATH_BTC) },
    run: async (host, draft) => {
      const payload = concatBytes(
        encodeRepeatedUint32(1, addressN(pathOf(draft, PATH_BTC))),
        encodeString(2, 'Bitcoin'),
        encodeBool(3, true),
      );
      const reply = await host.requireOneKey().call(OneKeyMessageType.GetAddress, payload);
      return decodeBitcoinAddress(reply.payload) || `0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'ok-btc-pubkey',
    brand: 'onekey',
    section: 'bitcoin',
    en: 'BTC GetPublicKey',
    zh: 'BTC 匯出公鑰',
    editor: { path: pathString(PATH_BTC) },
    run: okCall(OneKeyMessageType.GetPublicKey, PATH_BTC, encodeUint32(3, 1)),
  },
  {
    id: 'ok-btc-msg',
    brand: 'onekey',
    section: 'bitcoin',
    en: 'BTC SignMessage',
    zh: 'BTC 簽署訊息',
    editor: { path: pathString(PATH_BTC), utf8: 'hello btc' },
    run: okSign(OneKeyMessageType.SignMessage, PATH_BTC, new TextEncoder().encode('hello btc')),
  },
  {
    id: 'ok-btc-psbt',
    brand: 'onekey',
    section: 'bitcoin',
    en: 'BTC SignPsbt',
    zh: 'BTC 簽署 PSBT',
    editor: { hex: bytesToHex(samplePsbt()) },
    run: async (host, draft) => {
      const reply = await host.requireOneKey().call(OneKeyMessageType.SignPsbt, encodeBytes(1, payloadOf(draft, samplePsbt())));
      return `psbt 0x${bytesToHex(reply.payload).slice(0, 96)}`;
    },
  },
  {
    id: 'ok-sol-addr',
    brand: 'onekey',
    section: 'solana',
    en: 'SOL GetAddress',
    zh: 'SOL 匯出地址',
    editor: { path: pathString(PATH_SOL) },
    run: okCall(OneKeyMessageType.SolanaGetAddress, PATH_SOL, encodeUint32(2, 1)),
  },
    {
    id: 'ok-sol-sign',
    brand: 'onekey',
    section: 'solana',
    en: 'SOL SignTx',
    zh: 'SOL 簽署交易',
    editor: { path: pathString(PATH_SOL), hex: 'cafebabe' },
    run: okSign(OneKeyMessageType.SolanaSignTx, PATH_SOL, hexToBytes('0xcafebabe')),
  },
  {
    id: 'ok-sol-msg',
    brand: 'onekey',
    section: 'solana',
    en: 'SOL SignOffChainMessage',
    zh: 'SOL 簽署鏈下訊息',
    editor: { path: pathString(PATH_SOL), utf8: 'hello sol' },
    run: okSign(OneKeyMessageType.SolanaSignOffChainMessage, PATH_SOL, new TextEncoder().encode('hello sol')),
  },
  {
    id: 'ok-near-addr',
    brand: 'onekey',
    section: 'near',
    en: 'NEAR GetAddress',
    zh: 'NEAR 匯出地址',
    editor: { path: pathString(PATH_NEAR) },
    run: okCall(OneKeyMessageType.NearGetAddress, PATH_NEAR, encodeUint32(2, 1)),
  },
  {
    id: 'ok-near-sign',
    brand: 'onekey',
    section: 'near',
    en: 'NEAR SignTx',
    zh: 'NEAR 簽署交易',
    editor: { path: pathString(PATH_NEAR), hex: 'cafebabe' },
    run: okSign(OneKeyMessageType.NearSignTx, PATH_NEAR, hexToBytes('0xcafebabe')),
  },
  ...([
    ['ok-ada', 'family', 'ADA', PATH_ADA, OneKeyMessageType.CardanoGetAddress, undefined],
    ['ok-xrp', 'family', 'XRP', PATH_XRP, OneKeyMessageType.RippleGetAddress, OneKeyMessageType.RippleSignTx],
    ['ok-trx', 'family', 'TRX', PATH_TRX, OneKeyMessageType.TronGetAddress, OneKeyMessageType.TronSignTx],
    ['ok-trx-msg', 'family', 'TRX msg', PATH_TRX, undefined, OneKeyMessageType.TronSignMessage],
    ['ok-atom', 'family', 'ATOM', PATH_ATOM, OneKeyMessageType.CosmosGetAddress, OneKeyMessageType.CosmosSignTx],
    ['ok-ton', 'family', 'TON', PATH_TON, OneKeyMessageType.TonGetAddress, OneKeyMessageType.TonSignMessage],
    ['ok-apt', 'family', 'APT', PATH_APT, OneKeyMessageType.AptosGetAddress, OneKeyMessageType.AptosSignTx],
    ['ok-apt-msg', 'family', 'APT msg', PATH_APT, undefined, OneKeyMessageType.AptosSignMessage],
    ['ok-sui', 'family', 'SUI', PATH_SUI, OneKeyMessageType.SuiGetAddress, OneKeyMessageType.SuiSignTx],
    ['ok-sui-msg', 'family', 'SUI msg', PATH_SUI, undefined, OneKeyMessageType.SuiSignMessage],
    ['ok-dot', 'family', 'DOT', PATH_DOT, OneKeyMessageType.PolkadotGetAddress, OneKeyMessageType.PolkadotSignTx],
  ] as Array<[string, string, string, number[], number | undefined, number | undefined]>).flatMap(
    ([id, section, label, path, getAddr, signTx]) => {
      const actions: LabAction[] = [];
      if (getAddr) {
        actions.push({
          id: `${id}-addr`,
          brand: 'onekey',
          section,
          en: `${label} GetAddress`,
          zh: `${label} 匯出地址`,
          editor: { path: pathString(path) },
          run: okCall(getAddr, path, encodeUint32(2, 1)),
        });
      }
      if (signTx) {
        actions.push({
          id: `${id}-sign`,
          brand: 'onekey',
          section,
          en: `${label} Sign`,
          zh: `${label} 簽署`,
          editor: { path: pathString(path), hex: 'cafebabe' },
          run: okSign(signTx, path, hexToBytes('0xcafebabe')),
        });
      }
      return actions;
    },
  ),
];

function tzCall(
  type: number,
  path: number[],
  extra?: Uint8Array,
): (host: LabHost, draft: LabDraft) => Promise<string> {
  return async (host, draft) => {
    const payload = protoPath(trezorEncodeRepeatedUint32, pathOf(draft, path), extra);
    const reply = await host.requireTrezor().call(type, payload);
    return `type=${reply.type} 0x${bytesToHex(reply.payload).slice(0, 96)}`;
  };
}

function tzSign(
  type: number,
  path: number[],
  fallback: Uint8Array,
): (host: LabHost, draft: LabDraft) => Promise<string> {
  return async (host, draft) => {
    const message = payloadOf(draft, fallback);
    const payload = concatBytes(trezorEncodeRepeatedUint32(1, pathOf(draft, path)), trezorEncodeBytes(2, message));
    const reply = await host.requireTrezor().call(type, payload);
    return `type=${reply.type} 0x${bytesToHex(reply.payload).slice(0, 96)}`;
  };
}

const TREZOR: LabAction[] = [
  {
    id: 'tz-features',
    brand: 'trezor',
    section: 'trezor',
    en: 'Initialize / Features',
    zh: 'Initialize / Features',
    run: async (host) => {
      const reply = await host.requireTrezor().call(TrezorMessageType.Initialize, new Uint8Array());
      return `Features type=${reply.type}`;
    },
  },
  {
    id: 'tz-eth-addr',
    brand: 'trezor',
    section: 'ethereum',
    en: 'ETH GetAddress',
    zh: 'ETH 匯出地址',
    editor: { path: pathString(PATH_ETH) },
    run: async (host, draft) => {
      const payload = concatBytes(
        trezorEncodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        trezorEncodeUint32(2, 1),
      );
      const reply = await host.requireTrezor().call(TrezorMessageType.EthereumGetAddress, payload);
      return decodeTrezorAddress(reply.payload) || `0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'tz-eth-msg',
    brand: 'trezor',
    section: 'ethereum',
    en: 'ETH SignMessage',
    zh: 'ETH 簽署訊息',
    editor: { path: pathString(PATH_ETH), utf8: 'hello trezor' },
    run: async (host, draft) => {
      const message = payloadOf(draft, new TextEncoder().encode('hello trezor'));
      const payload = concatBytes(
        trezorEncodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        trezorEncodeBytes(2, message),
      );
      const reply = await host.requireTrezor().call(TrezorMessageType.EthereumSignMessage, payload);
      const decoded = decodeTrezorMessageSignature(reply.payload);
      return `${decoded.address}  sig 0x${bytesToHex(decoded.signature)}`;
    },
  },
  {
    id: 'tz-eth-tx',
    brand: 'trezor',
    section: 'ethereum',
    en: 'ETH SignTx',
    zh: 'ETH 簽署交易',
    editor: { path: pathString(PATH_ETH), hex: '1111111111111111111111111111111111111111' },
    run: async (host, draft) => {
      const to = payloadOf(draft, hexToBytes('0x1111111111111111111111111111111111111111'));
      const payload = concatBytes(
        trezorEncodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        trezorEncodeBytes(2, new Uint8Array()),
        trezorEncodeBytes(3, hexToBytes('0x3b9aca00')),
        trezorEncodeBytes(4, hexToBytes('0x5208')),
        trezorEncodeBytes(5, to),
        trezorEncodeBytes(6, new Uint8Array()),
        trezorEncodeBytes(7, new Uint8Array()),
        trezorEncodeUint32(11, 11155111),
      );
      const reply = await host.requireTrezor().call(TrezorMessageType.EthereumSignTx, payload);
      return `tx request 0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'tz-eth-1559',
    brand: 'trezor',
    section: 'ethereum',
    en: 'ETH SignTx EIP-1559',
    zh: 'ETH 簽署 EIP-1559',
    editor: { path: pathString(PATH_ETH), hex: '1111111111111111111111111111111111111111' },
    run: async (host, draft) => {
      const to = payloadOf(draft, hexToBytes('0x1111111111111111111111111111111111111111'));
      const payload = concatBytes(
        trezorEncodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        trezorEncodeBytes(2, new Uint8Array()),
        trezorEncodeBytes(3, hexToBytes('0x3b9aca00')),
        trezorEncodeBytes(4, hexToBytes('0x77359400')),
        trezorEncodeBytes(5, hexToBytes('0x5208')),
        trezorEncodeString(6, `0x${bytesToHex(to)}`),
        trezorEncodeBytes(7, new Uint8Array()),
        trezorEncodeBytes(8, new Uint8Array()),
        trezorEncodeUint32(10, 11155111),
      );
      const reply = await host.requireTrezor().call(TrezorMessageType.EthereumSignTxEIP1559, payload);
      return `tx request 0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'tz-eth-712',
    brand: 'trezor',
    section: 'ethereum',
    en: 'ETH SignTypedHash',
    zh: 'ETH 簽署類型雜湊',
    editor: { path: pathString(PATH_ETH), hex: `${'11'.repeat(32)}${'22'.repeat(32)}` },
    run: async (host, draft) => {
      const hashes = payloadOf(draft, hexToBytes(`0x${'11'.repeat(32)}${'22'.repeat(32)}`));
      const payload = concatBytes(
        trezorEncodeRepeatedUint32(1, addressN(pathOf(draft, PATH_ETH))),
        trezorEncodeBytes(2, hashes.subarray(0, 32)),
        trezorEncodeBytes(3, hashes.subarray(32, 64)),
      );
      const reply = await host.requireTrezor().call(TrezorMessageType.EthereumSignTypedHash, payload);
      return `sig 0x${bytesToHex(reply.payload)}`;
    },
  },
  {
    id: 'tz-btc-addr',
    brand: 'trezor',
    section: 'bitcoin',
    en: 'BTC GetAddress',
    zh: 'BTC 匯出地址',
    editor: { path: pathString(PATH_BTC) },
    run: tzCall(TrezorMessageType.GetAddress, PATH_BTC, trezorEncodeUint32(3, 1)),
  },
  {
    id: 'tz-btc-pubkey',
    brand: 'trezor',
    section: 'bitcoin',
    en: 'BTC GetPublicKey',
    zh: 'BTC 匯出公鑰',
    editor: { path: pathString(PATH_BTC) },
    run: tzCall(TrezorMessageType.GetPublicKey, PATH_BTC, trezorEncodeUint32(3, 1)),
  },
  {
    id: 'tz-btc-msg',
    brand: 'trezor',
    section: 'bitcoin',
    en: 'BTC SignMessage',
    zh: 'BTC 簽署訊息',
    editor: { path: pathString(PATH_BTC), utf8: 'hello btc' },
    run: tzSign(TrezorMessageType.SignMessage, PATH_BTC, new TextEncoder().encode('hello btc')),
  },
  {
    id: 'tz-btc-tx',
    brand: 'trezor',
    section: 'bitcoin',
    en: 'BTC SignTx (1-in-1-out)',
    zh: 'BTC 簽署交易',
    editor: { path: pathString(PATH_BTC) },
    run: async (host, draft) => {
      const trezor = host.requireTrezor();
      const start = await trezor.app(
        TrezorMessageType.SignTx,
        concatBytes(trezorEncodeUint32(1, 1), trezorEncodeUint32(2, 1)),
      );
      if (start.type !== TrezorMessageType.TxRequest) {
        throw new Error(`expected TxRequest, got ${start.type}`);
      }
      const input = concatBytes(
        trezorEncodeRepeatedUint32(1, pathOf(draft, PATH_BTC)),
        trezorEncodeBytes(2, new Uint8Array(32).fill(0x11)),
        trezorEncodeUint32(3, 0),
        trezorEncodeUint32(8, 10000),
      );
      const mid = await trezor.app(TrezorMessageType.TxAck, trezorEncodeMessage(1, trezorEncodeMessage(2, input)));
      const output = concatBytes(trezorEncodeString(1, 'bc1qtest'), trezorEncodeUint32(2, 8000));
      let next =
        mid.type === TrezorMessageType.TxRequest
          ? await trezor.app(TrezorMessageType.TxAck, trezorEncodeMessage(1, trezorEncodeMessage(5, output)))
          : mid;
      if (next.type === TrezorMessageType.ButtonRequest) {
        next = await trezor.app(TrezorMessageType.ButtonAck, new Uint8Array());
      }
      return `type=${next.type} 0x${bytesToHex(next.payload).slice(0, 96)}`;
    },
  },
  {
    id: 'tz-sol-addr',
    brand: 'trezor',
    section: 'solana',
    en: 'SOL GetAddress',
    zh: 'SOL 匯出地址',
    editor: { path: pathString(PATH_SOL) },
    run: tzCall(TrezorMessageType.SolanaGetAddress, PATH_SOL, trezorEncodeUint32(2, 1)),
  },
  {
    id: 'tz-sol-pub',
    brand: 'trezor',
    section: 'solana',
    en: 'SOL GetPublicKey',
    zh: 'SOL 匯出公鑰',
    editor: { path: pathString(PATH_SOL) },
    run: tzCall(TrezorMessageType.SolanaGetPublicKey, PATH_SOL, trezorEncodeUint32(2, 1)),
  },
  {
    id: 'tz-sol-sign',
    brand: 'trezor',
    section: 'solana',
    en: 'SOL SignTx',
    zh: 'SOL 簽署交易',
    editor: { path: pathString(PATH_SOL), hex: 'cafebabe' },
    run: tzSign(TrezorMessageType.SolanaSignTx, PATH_SOL, hexToBytes('0xcafebabe')),
  },
  {
    id: 'tz-ada-addr',
    brand: 'trezor',
    section: 'family',
    en: 'ADA GetAddress',
    zh: 'ADA 匯出地址',
    editor: { path: pathString(PATH_ADA) },
    run: tzCall(TrezorMessageType.CardanoGetAddress, PATH_ADA, trezorEncodeUint32(2, 1)),
  },
  {
    id: 'tz-xrp-addr',
    brand: 'trezor',
    section: 'family',
    en: 'XRP GetAddress',
    zh: 'XRP 匯出地址',
    editor: { path: pathString(PATH_XRP) },
    run: tzCall(TrezorMessageType.RippleGetAddress, PATH_XRP, trezorEncodeUint32(2, 1)),
  },
  {
    id: 'tz-xrp-sign',
    brand: 'trezor',
    section: 'family',
    en: 'XRP SignTx',
    zh: 'XRP 簽署',
    editor: { path: pathString(PATH_XRP), hex: 'cafebabe' },
    run: tzSign(TrezorMessageType.RippleSignTx, PATH_XRP, hexToBytes('0xcafebabe')),
  },
];

export const LAB_ACTIONS: LabAction[] = [...LEDGER, ...ONEKEY, ...TREZOR];

async function signEthTxBytes(
  host: LabHost,
  raw: Uint8Array,
  path: number[],
  note: string,
  app = 'Ethereum',
): Promise<Uint8Array> {
  const tx = host.requireLedger();
  await tx.openApp(app);
  const first = concatBytes(encodePath(path), raw);
  if (first.length <= 255) {
    return tx.sendOk(0xe0, 0x04, 0x00, 0x00, first, note);
  }
  const head = first.subarray(0, 255);
  const rest = first.subarray(255);
  await assertOk(await tx.send(0xe0, 0x04, 0x00, 0x00, head), `${note} chunk0`);
  return tx.sendOk(0xe0, 0x04, 0x80, 0x00, rest, note);
}

async function signEthTx(
  host: LabHost,
  raw: Uint8Array,
  path: number[],
  note: string,
  app = 'Ethereum',
): Promise<string> {
  return `sig 0x${bytesToHex(await signEthTxBytes(host, raw, path, note, app))}`;
}

async function btcExport(host: LabHost, app: string, path: number[]): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp(app);
  return describeKey(await tx.sendOk(0xe0, 0x40, 0x00, 0x00, encodePath(path), `${app} GET_WALLET_PUBLIC_KEY`));
}

async function btcHash(host: LabHost, app: string, path: number[], hash: Uint8Array): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp(app);
  const body = await tx.sendOk(0xe0, 0x48, 0x00, 0x00, concatBytes(encodePath(path), hash.subarray(0, 32)), `${app} HASH`);
  return `der 0x${bytesToHex(body)}`;
}

async function btcMessage(host: LabHost, app: string, path: number[], message: Uint8Array): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp(app);
  const body = await tx.sendOk(0xe0, 0x4e, 0x00, 0x00, concatBytes(encodePath(path), message), `${app} SIGN_MESSAGE`);
  return `sig 0x${bytesToHex(body)}`;
}

async function avaxSignHash(host: LabHost, path: number[], hash: Uint8Array, p2: number): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp('Avalanche');
  const digest = hash.length >= 32 ? hash.subarray(0, 32) : hash;
  await tx.sendOk(0x80, 0x04, 0x01, p2, concatBytes(encodePath(path), digest), 'AVAX SIGN_HASH first');
  const body = await tx.sendOk(0x80, 0x04, 0x02, p2, encodePath([]), 'AVAX SIGN_HASH last');
  return `sig 0x${bytesToHex(body)}`;
}

async function avaxSignPayload(host: LabHost, ins: number, path: number[], payload: Uint8Array): Promise<string> {
  const tx = host.requireLedger();
  await tx.openApp('Avalanche');
  await tx.sendOk(0x80, ins, 0x00, 0x00, concatBytes(encodePath(path), payload), 'AVAX sign init');
  const body = await tx.sendOk(0x80, ins, 0x02, 0x00, new Uint8Array(), 'AVAX sign last');
  return `0x${bytesToHex(body)}`;
}
