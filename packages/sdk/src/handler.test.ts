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
  it('builds a Ledger handler for Nano X, Flex, Stax, and Gen5', () => {
    for (const id of ['nano-x', 'flex', 'stax', 'gen5']) {
      const model = ALL_MODELS.find((item) => item.id === id)!;
      const handler = createHandler({
        model,
        confirmation,
        slotId: 'slot',
        entropy,
      });
      expect(handler.brand).toBe('ledger');
      expect(handler.getServiceUUID()).toBe(model.serviceUUID);
      expect(isSimulatable(model)).toBe(true);
    }
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

  it('builds a Trezor THP handler for Safe 7', () => {
    const model = ALL_MODELS.find((item) => item.id === 'safe-7')!;
    const handler = createHandler({
      model,
      confirmation,
      slotId: 'slot',
      entropy,
    });
    expect(handler.brand).toBe('trezor');
    expect(handler.getServiceUUID()).toBe(model.serviceUUID);
    expect(isSimulatable(model)).toBe(true);
  });

  it('rejects OneKey V2 until a later phase', () => {
    const pro2 = ALL_MODELS.find((item) => item.id === 'pro2')!;
    expect(isSimulatable(pro2)).toBe(false);
    expect(() =>
      createHandler({ model: pro2, confirmation, slotId: 'slot', entropy }),
    ).toThrow(/not implemented/);
  });
});
