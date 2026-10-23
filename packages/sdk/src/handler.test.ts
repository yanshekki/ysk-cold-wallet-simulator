import { describe, expect, it } from 'vitest';
import { ALL_MODELS, type ConfirmationPort } from '@cws/contracts';
import { createHandler, isSimulatable } from './handler';

const confirmation: ConfirmationPort = {
  async confirm() {
    return true;
  },
  async getPassphrase() {
    return undefined;
  },
};

const entropy = new Uint8Array(16).map((_, i) => i + 1);

describe('createHandler', () => {
  it('builds a Ledger handler for Nano X', () => {
    const model = ALL_MODELS.find((item) => item.id === 'nano-x')!;
    const handler = createHandler({
      model,
      confirmation,
      slotId: 'slot',
      entropy,
    });
    expect(handler.brand).toBe('ledger');
    expect(isSimulatable(model)).toBe(true);
  });

  it('builds a OneKey V1 handler for Classic', () => {
    const model = ALL_MODELS.find((item) => item.id === 'classic')!;
    const handler = createHandler({
      model,
      confirmation,
      slotId: 'slot',
      entropy,
    });
    expect(handler.brand).toBe('onekey');
    expect(handler.getServiceUUID()).toBe(model.serviceUUID);
    expect(isSimulatable(model)).toBe(true);
  });

  it('rejects Trezor THP and OneKey V2 until later phases', () => {
    const trezor = ALL_MODELS.find((item) => item.protocol === 'thp')!;
    const pro2 = ALL_MODELS.find((item) => item.id === 'pro2')!;
    expect(isSimulatable(trezor)).toBe(false);
    expect(isSimulatable(pro2)).toBe(false);
    expect(() =>
      createHandler({ model: trezor, confirmation, slotId: 'slot', entropy }),
    ).toThrow(/not implemented/);
    expect(() =>
      createHandler({ model: pro2, confirmation, slotId: 'slot', entropy }),
    ).toThrow(/not implemented/);
  });
});
