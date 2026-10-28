/** Kinds a BLE write must not drive until the phone allows that central. */
const HOST_GATED_KINDS = new Set(['sign', 'export-seed']);

export type BleBondState = 'none' | 'bonding' | 'bonded' | 'unsupported';

/**
 * A platform link key skips the extra sheet. iOS reports `unsupported`
 * because CoreBluetooth does not expose the bond, so those hosts use the
 * phone confirm instead of stalling every GATT write.
 */
export function linkKeySatisfiesBleSign(bond: BleBondState | null): boolean {
  return bond === 'bonded';
}

export async function centralHasLinkKey(
  centralId: string | null,
  readBond: (id: string) => Promise<BleBondState>,
): Promise<boolean> {
  if (!centralId) {
    return false;
  }
  try {
    const bond = await Promise.race([
      readBond(centralId),
      new Promise<BleBondState>((resolve) => {
        setTimeout(() => resolve('unsupported'), 400);
      }),
    ]);
    return linkKeySatisfiesBleSign(bond);
  } catch {
    return false;
  }
}

export function bleHostLabel(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 13) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export class BleSignHostGate {
  private depth = 0;
  private centralId: string | null = null;
  private readonly allowed = new Set<string>();

  beginWrite(): void {
    this.depth += 1;
  }

  endWrite(): void {
    this.depth = Math.max(0, this.depth - 1);
  }

  setCentral(id: string | null): void {
    const trimmed = id?.trim() ?? '';
    this.centralId = trimmed.length > 0 ? trimmed : null;
  }

  allowCurrent(): void {
    if (this.centralId) {
      this.allowed.add(this.centralId);
    }
  }

  reset(): void {
    this.depth = 0;
    this.centralId = null;
    this.allowed.clear();
  }

  needsConfirm(kind: string, linkKey: boolean): boolean {
    if (this.depth <= 0) {
      return false;
    }
    if (!HOST_GATED_KINDS.has(kind)) {
      return false;
    }
    if (linkKey) {
      return false;
    }
    if (this.centralId && this.allowed.has(this.centralId)) {
      return false;
    }
    return true;
  }

  currentCentral(): string | null {
    return this.centralId;
  }
}

export const bleSignHostGate = new BleSignHostGate();
