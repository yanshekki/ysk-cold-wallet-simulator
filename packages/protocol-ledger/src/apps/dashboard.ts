import { ledgerCatalog, ledgerOsFor, type LedgerApp } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
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

/**
 * GET_VERSION / GET_APP_AND_VERSION first flag byte.
 * Ledger Live only treats the device as onboarded when flags are exactly 4
 * bytes and bit 0x04 is set. Bit 0x08 is managerAllowed, 0x80 pinValidated.
 */
export const SE_FLAG_ONBOARDED = 0x04;
export const SE_FLAG_MANAGER_ALLOWED = 0x08;
export const SE_FLAG_PIN_VALIDATED = 0x80;

const DEVICE_NAMES: Record<string, string> = {
  'nano-x': 'Nano X',
  stax: 'Stax',
  flex: 'Flex',
  gen5: 'Nano G5',
};

export function targetIdFor(modelId: string): Uint8Array {
  return TARGET_IDS[modelId] ?? TARGET_IDS['nano-x'];
}

export function versionFlags(managerAllowed: boolean): Uint8Array {
  const flags0 =
    SE_FLAG_ONBOARDED |
    SE_FLAG_PIN_VALIDATED |
    (managerAllowed ? SE_FLAG_MANAGER_ALLOWED : 0);
  return Uint8Array.of(flags0, 0x00, 0x40, 0x0b);
}

function lengthPrefixed(data: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(data.length), data);
}

function lengthPrefixedAscii(text: string): Uint8Array {
  return lengthPrefixed(encodeAscii(text));
}

export function encodeAppAndVersion(name: string, version: string): Uint8Array {
  const nameBytes = encodeAscii(name);
  const versionBytes = encodeAscii(version);
  const flags = Uint8Array.of(SE_FLAG_ONBOARDED | SE_FLAG_PIN_VALIDATED | SE_FLAG_MANAGER_ALLOWED);
  return encodeResponse(
    concatBytes(
      Uint8Array.of(0x01),
      Uint8Array.of(nameBytes.length),
      nameBytes,
      Uint8Array.of(versionBytes.length),
      versionBytes,
      Uint8Array.of(flags.length),
      flags,
    ),
    SW_OK,
  );
}

export function getAppAndVersion(modelId = 'nano-x'): Uint8Array {
  return encodeAppAndVersion('BOLOS', ledgerOsFor(modelId).se);
}

export function getAppAndVersionFor(app: LedgerApp, modelId: string): Uint8Array {
  if (app === 'dashboard') {
    return getAppAndVersion(modelId);
  }
  const installed = ledgerCatalog().find((item) => item.id === app);
  if (installed) {
    return encodeAppAndVersion(installed.openAppName, installed.version);
  }
  return getAppAndVersion(modelId);
}

/**
 * Optional GET_VERSION TLV fields after MCU version. Ledger Wallet's parser
 * (live-common getVersion) reads them when seVersion satisfies per-device
 * ranges. Missing bytes throw and abort Early Security Check.
 *
 * Nano X 2.x: bootloader, hardwareVersion, languageId, recoverState.
 * Stax/Flex/Gen5: bootloader, languageId, recoverState, charonState.
 */
function optionalGetVersionFields(modelId: string): Uint8Array[] {
  const os = ledgerOsFor(modelId);
  const bootloader = lengthPrefixedAscii(os.bootloader);
  const hardware = lengthPrefixed(Uint8Array.of(0x00));
  const language = lengthPrefixed(Uint8Array.of(0x00));
  const recover = Uint8Array.of(0x00);
  const charon = Uint8Array.of(0x00);
  if (modelId === 'nano-x') {
    return [bootloader, hardware, language, recover];
  }
  return [bootloader, language, recover, charon];
}

export function getFirmwareVersion(modelId = 'nano-x', managerAllowed = false): Uint8Array {
  const os = ledgerOsFor(modelId);
  return encodeResponse(
    concatBytes(
      targetIdFor(modelId),
      lengthPrefixedAscii(os.se),
      lengthPrefixed(versionFlags(managerAllowed)),
      lengthPrefixedAscii(os.mcu),
      ...optionalGetVersionFields(modelId),
    ),
    SW_OK,
  );
}

export function getDeviceName(modelId = 'nano-x'): Uint8Array {
  return encodeResponse(encodeAscii(DEVICE_NAMES[modelId] ?? 'Nano X'), SW_OK);
}

/** getAppStorageInfo: size 0 means no backup payload. */
export function getAppStorageInfo(): Uint8Array {
  return encodeResponse(Uint8Array.of(0x00, 0x00, 0x00, 0x00), SW_OK);
}

export function openAppName(data: Uint8Array): string {
  return Array.from(data, (b) => String.fromCharCode(b)).join('');
}

/**
 * LIST_APPS (E0 DE) stream used by Ledger Wallet:
 * [entryLen][blocks:u16][hash:32][nameLen][name]
 */
export function encodeListApps(): Uint8Array {
  const entries = ledgerCatalog().map((app) => {
    const name = encodeAscii(app.openAppName);
    const hash = sha256(encodeAscii(app.id));
    const inner = concatBytes(Uint8Array.of(0x00, 0x08), hash, Uint8Array.of(name.length), name);
    return concatBytes(Uint8Array.of(inner.length), inner);
  });
  return encodeResponse(concatBytes(...entries), SW_OK);
}

export const MANAGER_INS = new Set([0x12, 0x14, 0x16, 0x18, 0x20, 0x22, 0x51]);
