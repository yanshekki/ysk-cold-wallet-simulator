import { ALL_MODELS, type DeviceModel } from '@cws/contracts';
import { LedgerProtocolHandler, type LedgerHandlerOptions } from '@cws/protocol-ledger';

export {
  entropyByteLength,
  entropyFromMnemonic,
  generateEntropy,
  mnemonicFromEntropy,
  wordCountFromEntropy,
  type WordCount,
} from './entropy';

export function getModel(id: string): DeviceModel | undefined {
  return ALL_MODELS.find((model) => model.id === id);
}

export function listModels(): DeviceModel[] {
  return ALL_MODELS;
}

export function createLedgerHandler(options: LedgerHandlerOptions): LedgerProtocolHandler {
  return new LedgerProtocolHandler(options);
}
