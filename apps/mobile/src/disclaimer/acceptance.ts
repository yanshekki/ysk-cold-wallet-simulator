import { DISCLAIMER_VERSION } from './version';

export type DisclaimerRecord = {
  version: number;
  acceptedAt: number;
};

export function parseDisclaimerRecord(raw: string | null): DisclaimerRecord | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DisclaimerRecord>;
    if (typeof parsed.version !== 'number' || typeof parsed.acceptedAt !== 'number') {
      return null;
    }
    return { version: parsed.version, acceptedAt: parsed.acceptedAt };
  } catch {
    return null;
  }
}

export function isDisclaimerAccepted(
  raw: string | null,
  currentVersion = DISCLAIMER_VERSION,
): boolean {
  return parseDisclaimerRecord(raw)?.version === currentVersion;
}
