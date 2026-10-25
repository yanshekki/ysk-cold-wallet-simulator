import { ALL_MODELS, type DeviceModel } from '@cws/contracts';

export {
  entropyByteLength,
  entropyFromMnemonic,
  generateEntropy,
  isBip39WordCount,
  isValidBip39Mnemonic,
  mnemonicFromEntropy,
  normalizeWords,
  wordCountFromEntropy,
  wordCountOf,
  type Bip39WordCount,
  type WordCount,
} from './entropy';

export { combineSlip39, generateSlip39, isSlip39Mnemonic, type Slip39Backup, type Slip39Scheme } from './slip39';

export { toBip32Seed } from './seed';

export {
  inspectAddresses,
  inspectAddressesChunked,
  FAST_INSPECT_IDS,
  SLOW_INSPECT_IDS,
  PREVIEW_INSPECT_IDS,
  INSPECT_CHUNK_SIZE,
  type InspectRow,
} from './derive';
export { isKnownUnsafeMnemonic, KNOWN_UNSAFE_MNEMONICS } from './knownMnemonics';
export { mixExtraEntropy } from './mixEntropy';
export {
  bytesToEntropyHex,
  entropyBitsForWordCount,
  minDiceRolls,
  minHexChars,
  parseCustomEntropy,
  type CustomEntropyKind,
} from './customEntropy';
export { fetchManagerCatalog, managerCatalogUrl, parseManagerApps } from './ledgerManager';

export {
  createHandler,
  createLedgerHandler,
  isSimulatable,
  splitNotify,
  DEFAULT_MTU,
  type CreateHandlerOptions,
} from './handler';

export function getModel(id: string): DeviceModel | undefined {
  return ALL_MODELS.find((model) => model.id === id);
}

export function listModels(): DeviceModel[] {
  return ALL_MODELS;
}
