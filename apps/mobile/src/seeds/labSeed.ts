import type { Brand, SeedSlot } from '@cws/contracts';
import { deleteSlot, listSlots, saveSlot } from './vault';
import { generateSecureSecret } from './generate';

export const DEV_LOCAL_ID = 'dev-local';
const LEGACY_LAB_ID = 'dev-lab';

export async function ensureDevLocalSeed(brand: Brand, modelId: string): Promise<SeedSlot> {
  const slots = await listSlots();
  const existing = slots.find((slot) => slot.id === DEV_LOCAL_ID);
  if (existing) {
    return existing;
  }
  const legacy = slots.find((slot) => slot.id === LEGACY_LAB_ID);
  if (legacy) {
    await deleteSlot(LEGACY_LAB_ID);
  }
  const entropy = await generateSecureSecret(32);
  return saveSlot(
    {
      id: DEV_LOCAL_ID,
      label: 'DEV local',
      brand,
      modelId,
      wordCount: 24,
      createdAt: Date.now(),
    },
    entropy,
  );
}
