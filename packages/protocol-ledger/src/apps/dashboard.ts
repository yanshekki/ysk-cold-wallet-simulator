import { concatBytes, encodeAscii } from '../bytes';
import { encodeResponse, SW_OK } from '../apdu';

/** Nano X MCU/SE identity used by Ledger Live version parsers. */
export const NANO_X_TARGET_ID = Uint8Array.of(0x33, 0x00, 0x00, 0x04);
export const BOLOS_VERSION = '2.2.3';
export const MCU_VERSION = '2.30';

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

export function getFirmwareVersion(): Uint8Array {
  const se = encodeAscii(BOLOS_VERSION);
  const flags = Uint8Array.of(0x00);
  const mcu = encodeAscii(MCU_VERSION);
  return encodeResponse(
    concatBytes(
      NANO_X_TARGET_ID,
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
