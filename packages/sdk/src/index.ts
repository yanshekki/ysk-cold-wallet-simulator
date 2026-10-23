import { ALL_MODELS, type DeviceModel } from '@cws/contracts';

export {
  entropyByteLength,
  entropyFromMnemonic,
  generateEntropy,
  mnemonicFromEntropy,
  wordCountFromEntropy,
  type WordCount,
} from './entropy';

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
