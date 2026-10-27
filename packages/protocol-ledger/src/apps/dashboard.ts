import { ledgerCatalog, ledgerOsFor, ledgerPickerRank, type LedgerApp } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes, decodeAscii, encodeAscii } from '../bytes';
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

export type AppAndVersion = {
  name: string;
  version?: string;
  flags?: Uint8Array;
};

function isLedgerAppName(name: string): boolean {
  if (name.length < 2 || name.length > 32) {
    return false;
  }
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    const letter = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    const digit = code >= 0x30 && code <= 0x39;
    const mark = code === 0x20 || code === 0x2e || code === 0x2d || code === 0x5f;
    if (!letter && !digit && !mark) {
      return false;
    }
  }
  return /[A-Za-z]/.test(name);
}

/**
 * Ledger DMK GetAppAndVersionCommand requires format 1, a name LV, then a
 * version LV. A 9-byte `01 05 BOLOS 9000` reply (name + SW only) throws and
 * Core.app surfaces TimeoutError with no UI progress.
 * Solana GET_APP_CONFIGURATION (`01 major minor patch 9000`) must not parse.
 */
export function parseAppAndVersion(payload: Uint8Array): AppAndVersion | undefined {
  if (payload.length < 4) {
    return undefined;
  }
  const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
  if (sw !== SW_OK) {
    return undefined;
  }
  const data = payload.subarray(0, payload.length - 2);
  if (data[0] !== 0x01 || data.length < 2) {
    return undefined;
  }
  let offset = 1;
  const nameLen = data[offset];
  offset += 1;
  if (offset + nameLen > data.length) {
    return undefined;
  }
  const name = decodeAscii(data.subarray(offset, offset + nameLen));
  if (!isLedgerAppName(name)) {
    return undefined;
  }
  offset += nameLen;
  let version: string | undefined;
  if (offset < data.length) {
    const versionLen = data[offset];
    offset += 1;
    if (offset + versionLen > data.length) {
      return { name };
    }
    version = decodeAscii(data.subarray(offset, offset + versionLen));
    offset += versionLen;
  }
  let flags: Uint8Array | undefined;
  if (offset < data.length) {
    const flagsLen = data[offset];
    offset += 1;
    if (offset + flagsLen <= data.length) {
      flags = data.subarray(offset, offset + flagsLen);
    }
  }
  return { name, version, flags };
}

function versionForAppName(name: string): string {
  if (name === 'BOLOS') {
    return ledgerOsFor('nano-x').se;
  }
  const installed = ledgerCatalog().find((item) => item.openAppName === name);
  return installed?.version ?? '1.0.0';
}

export function completeAppAndVersion(payload: Uint8Array): Uint8Array {
  const parsed = parseAppAndVersion(payload);
  if (!parsed || (parsed.version && parsed.version.length > 0)) {
    return payload;
  }
  return encodeAppAndVersion(parsed.name, versionForAppName(parsed.name));
}

function statusWord(payload: Uint8Array): number | undefined {
  if (payload.length < 2) {
    return undefined;
  }
  return (payload[payload.length - 2] << 8) | payload[payload.length - 1];
}

/**
 * DMK GetAppAndVersionCommand requires format 1 + name LV + version LV.
 * A 9-byte name-only reply, a GET_APP echo (`b0 01 …`), or other garbage
 * makes the parser throw EmptyError and Core stays on 連接.
 * Only call this for GET_APP_AND_VERSION (CLA 0xb0 INS 0x01) replies.
 */
export function ensureAppAndVersion(payload: Uint8Array, fallbackName = 'BOLOS'): Uint8Array {
  const completed = completeAppAndVersion(payload);
  const parsed = parseAppAndVersion(completed);
  if (parsed?.version) {
    return completed;
  }
  const sw = statusWord(payload);
  if (sw !== undefined && sw !== SW_OK && (sw & 0xf000) === 0x6000) {
    return payload;
  }
  return encodeAppAndVersion(fallbackName, versionForAppName(fallbackName));
}

export function describeAppAndVersion(payload: Uint8Array): string | undefined {
  const parsed = parseAppAndVersion(ensureAppAndVersion(payload));
  if (!parsed) {
    return undefined;
  }
  return parsed.version ? `${parsed.name} ${parsed.version}` : parsed.name;
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
 * Cap entries so the reply fits BLE seq<=64 at the 20-byte iOS MTU.
 */
const LIST_APPS_CAP = 20;

export function encodeListApps(): Uint8Array {
  const ranked = [...ledgerCatalog()].sort((a, b) => {
    const rank = ledgerPickerRank(a.id) - ledgerPickerRank(b.id);
    return rank !== 0 ? rank : a.openAppName.localeCompare(b.openAppName);
  });
  const entries = ranked.slice(0, LIST_APPS_CAP).map((app) => {
    const name = encodeAscii(app.openAppName);
    const hash = sha256(encodeAscii(app.id));
    const inner = concatBytes(Uint8Array.of(0x00, 0x08), hash, Uint8Array.of(name.length), name);
    return concatBytes(Uint8Array.of(inner.length), inner);
  });
  return encodeResponse(concatBytes(...entries), SW_OK);
}

export const MANAGER_INS = new Set([0x12, 0x14, 0x16, 0x18, 0x20, 0x22, 0x51]);
