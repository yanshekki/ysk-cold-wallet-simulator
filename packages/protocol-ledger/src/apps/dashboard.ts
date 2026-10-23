import { concatBytes, encodeAscii } from '../bytes';
import { encodeResponse, SW_OK } from '../apdu';

/** MCU/SE identity used by Ledger Live `identifyTargetId` (high 16 bits). */
export const TARGET_IDS: Record<string, Uint8Array> = {
  'nano-x': Uint8Array.of(0x33, 0x00, 0x00, 0x04),
  stax: Uint8Array.of(0x33, 0x20, 0x00, 0x04),
  flex: Uint8Array.of(0x33, 0x30, 0x00, 0x04),
  gen5: Uint8Array.of(0x33, 0x40, 0x00, 0x04),
};

export const NANO_X_TARGET_ID = TARGET_IDS['nano-x'];
export const BOLOS_VERSION = '2.2.3';
export const MCU_VERSION = '2.30';

export function targetIdFor(modelId: string): Uint8Array {
  return TARGET_IDS[modelId] ?? TARGET_IDS['nano-x'];
}

export function getAppAndVersion(): Uint8Array {
  const name = encodeAscii('BOLOS');
  const version = encodeAscii(BOLOS_VERSION);
  const flags = Uint8Array.of(0x00);
  return encodeResponse(
    concatBytes(
      Uint8Array.of(0x01),
      Uint8Array.of(name.length),
      name,
      Uint8Array.of(version.length),
      version,
      Uint8Array.of(flags.length),
      flags,
    ),
    SW_OK,
  );
}

export function getFirmwareVersion(modelId = 'nano-x'): Uint8Array {
  const se = encodeAscii(BOLOS_VERSION);
  const flags = Uint8Array.of(0x00);
  const mcu = encodeAscii(MCU_VERSION);
  return encodeResponse(
    concatBytes(
      targetIdFor(modelId),
      Uint8Array.of(se.length),
      se,
      Uint8Array.of(flags.length),
      flags,
      Uint8Array.of(mcu.length),
      mcu,
    ),
    SW_OK,
  );
}

export function openAppName(data: Uint8Array): string {
  return Array.from(data, (b) => String.fromCharCode(b)).join('');
}
