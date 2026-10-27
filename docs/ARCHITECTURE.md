# YSK Cold Wallet Simulator — Architecture Document

**Project Name:** `ysk-cold-wallet-simulator`  
**Display Name:** YSK Cold Wallet Simulator  
**Style:** ysk-kit (Expo TypeScript monorepo)  
**Scope:** Phone-as-device simulator for Ledger / Trezor / OneKey. Primary transport is BLE GATT peripheral. USB HID is bridged through `apps/proxy` + `packages/native-proxy`. Air-gap QR lives in `packages/protocol-qr`.  
**Platform Priority:** Android first. iOS if feasible (with known background limitations).  
**No mocks.** Real protocol implementations for every supported product.

---

## 1. Supported Products (Research Summary)

Only products that officially support BLE are included.

### Ledger (BLE APDU over GATT)

| Model          | BLE Support | Service UUID (Main)                          | Notes |
|----------------|-------------|----------------------------------------------|-------|
| Nano X         | Yes         | `13d63400-2c97-0004-0000-4c6564676572`      | Classic |
| Flex           | Yes         | `13d63400-2c97-3004-0000-4c6564676572`      | E-Ink touch |
| Stax           | Yes         | `13d63400-2c97-6004-0000-4c6564676572`      | Large E-Ink |
| Nano Gen5 (Apex) | Yes       | `13d63400-2c97-8004-0000-4c6564676572`      | Primary set; rare bootloader set `...-9004-...` |

**Characteristics (pattern for all models):**
- Notify: `...-0001-...`
- Write (with response): `...-0002-...`
- Write Command (without response): `...-0003-...`

**Framing (Ledger BLE Transport):**
- Tag `0x05` + 2-byte sequence (BE) + 2-byte length (BE) + payload
- Continuation packets continue the sequence
- Initial MTU negotiation via `0x08` query (default 20, negotiate up to ~153)
- APDU is standard ISO 7816-4 style (CLA INS P1 P2 Lc Data Le)

Source: Ledger Developer Portal identifiers + historical Nano X BLE spec (btchip gist).

### Trezor

| Model     | BLE Support | Protocol     | Service UUID                              |
|-----------|-------------|--------------|-------------------------------------------|
| Safe 7    | Yes         | THP v2       | `8c000001-a59b-4d58-a9ad-073df69fa1b1`   |

**Characteristics:**
- RX (Write): `8c000002-a59b-4d58-a9ad-073df69fa1b1`
- TX (Notify): `8c000003-a59b-4d58-a9ad-073df69fa1b1`

**THP Layers:**
- L1: BLE packets (up to 244 bytes)
- L2: Framing (magic, channel, length, CRC-32)
- L3: Noise XX handshake (X25519 + AES-GCM) — mandatory encrypted channel
- L4: Protobuf application messages

Only Safe 7 has BLE. Older models are USB-only.

### OneKey

| Model              | Protocol | BLE Support | Notes |
|--------------------|----------|-------------|-------|
| Classic / Classic 1s / Pure | V1 | Yes | |
| Touch              | V1       | Yes | |
| Pro                | V1       | Yes | |
| Pro 2              | V2       | Yes | |
| Neo                | V2       | Yes | No camera |
| Mini               | V1       | **No** | Excluded |

**Common BLE UUIDs (all BLE models):**
- Service: `00000001-0000-1000-8000-00805f9b34fb`
- Write: `00000002-0000-1000-8000-00805f9b34fb`
- Notify: `00000003-0000-1000-8000-00805f9b34fb`

**Protocol V1 header:** Magic `3F 23 23` + 2-byte message type (BE) + 4-byte payload length (BE) + protobuf.  
**Protocol V2:** Raw chunks with CRC + sequence; no 3F2323 header. SDK assembles.

---

## 2. High-Level Architecture (ysk-kit Style)

```
ysk-cold-wallet-simulator/
├── apps/
│   ├── mobile/                 # Expo app (BLE peripheral + vault + QR)
│   └── proxy/                  # Local HID/BLE daemon + macOS CWS Proxy + testnet host catalog
├── packages/
│   ├── contracts/              # Shared types plus derivation/preview/EIP-712 helpers
│   ├── sdk/                    # createHandler, entropy, QR air-gap policy
│   ├── ui/                     # Presentation (SigningModal, DeviceCard, LogEditor)
│   ├── protocol-ledger/        # Ledger APDU + BLE framing
│   ├── protocol-trezor/        # THP (Noise XX + protobuf)
│   ├── protocol-onekey/        # OneKey V1 + V2
│   ├── protocol-qr/            # UR / BBQR / PSBT air-gap codecs
│   └── native-proxy/           # Rust HID gadget used by apps/proxy
└── docs/
    └── ARCHITECTURE.md
```

**Principles:**
- Protocol packages contain real protocol logic (no mocks)
- `createHandler` in `@cws/sdk` is the BLE factory; QR export/scan is `exportQrAccountWithPolicy` / `QrAirgapSession`
- App owns BLE lifecycle, SecureStore vault, and session passphrase (RAM only)
- UI is mostly presentation; signing always goes through `ConfirmationPort` → `SigningModal`
- `contracts` is the shared type + preview layer, not types-only (RLP/ERC-20/EIP-712 live there so protocol-ledger does not import protocol-qr for hashing)

---

## 3. BLE Peripheral Layer

**Library choice:** `munim-bluetooth` (or `munim-bluetooth-peripheral`) — actively maintained, Expo-compatible, full peripheral + GATT server support on both Android and iOS.

**Why not react-native-ble-plx:** It is central-only (phone as client). Peripheral mode requires a dedicated library.

**Responsibilities:**
1. Advertise the exact Service UUID of the selected model
2. Advertise a local name that matches real devices (e.g. `Ledger Nano X`, `Trezor Safe 7`, `OneKey Pro`)
3. Implement GATT server with the correct characteristics
4. Handle Write / WriteWithoutResponse → feed into protocol handler
5. Send Notify responses back to the connected host
6. Negotiate MTU where possible

**Android:** Full support, including background advertising (with foreground service recommended).  
**iOS:** Possible, but background time is limited. App should stay in foreground for reliable simulation. Document this limitation clearly in UI.

**Security of BLE link:** Real devices use LE Secure Connections (Numeric Comparison). The simulator should request encrypted links where the library allows. Hosts (Ledger Live, Trezor Suite, OneKey app) will still treat the phone as a legitimate device once the protocol layer answers correctly.

---

## 4. Seed Security (Most Secure Possible)

### Entropy Source (Critical)

**Correct method (research-backed):**

```ts
import * as Crypto from 'expo-crypto';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// 16 bytes = 12 words, 32 bytes = 24 words
const entropy = await Crypto.getRandomBytesAsync(wordCount === 12 ? 16 : 32);
const mnemonic = entropyToMnemonic(entropy, wordlist);
```

**Why this is real:**
- `expo-crypto.getRandomBytesAsync` uses Android `SecureRandom` (/dev/urandom) and iOS `SecRandomCopyBytes` — both cryptographically secure.
- Do **not** use `Math.random`, `crypto.getRandomValues` polyfills that fall back to insecure sources, or any WASM-based RNG that has been observed to return zeros on Android after first call.
- Validate with `@scure/bip39` (audited, constant-time friendly).

**Never store the raw mnemonic.**  
Store only the 64-byte BIP39 seed (or 32-byte entropy) encrypted.

### Storage

Use `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Entropy is **not** written on web (`saveSlot` throws rather than using `localStorage`).

```ts
await SecureStore.setItemAsync(key, base64Seed, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});
```

**Tradeoff:** `requireAuthentication: true` is **not** set. Extra biometric prompts on every SecureStore read fail under iPhone Mirroring (“continue on iPhone”). The 15-minute app session already required the platform authenticator. Release builds should keep the Settings biometric toggle on; turning it off still allows Start in the current code.

- Android: Hardware-backed Keystore when available
- iOS: Keychain, device-unlocked
- Passphrase is **never** persisted. `SecretSession` keeps the derived seed in RAM. Host-supplied Trezor passphrases must surface on the signing chip (`passphraseSource: 'host'`) and must not silently override a device-applied seed.
- `crypto-seed` QR export requires `SigningModal` (`kind: 'export-seed'`). xpub / hdkey export may stay silent, matching GET_ADDRESS P1=0.

### Multiple Seeds

Each seed is a slot:
- `id` (UUID)
- `label` (user-defined)
- `brand` + `model` (for UI)
- `wordCount` (12 or 24)
- `createdAt`
- Encrypted seed blob in SecureStore under a unique key

---

## 5. App Unlock (local authentication)

This repo has **no associated domain**, so full WebAuthn passkeys are not used. Unlock is `expo-local-authentication` (OS biometric / device passcode) in `apps/mobile/src/passkeys/session.ts`.

**Flow:**

1. Disclaimer, then Unlock.
2. Release: OS biometric / passcode. Success unlocks a session (`autoLockMinutes`, default 15).
3. Debug: skip the OS prompt, Android FLAG_SECURE, and the new-seed verify quiz so USB / screenshot-gated lab tests can proceed (annotated in code). Release keeps all three.
4. Session expiry returns to `/unlock`. Passphrase overlay is wiped with `SecretSession`.

Do not document this as a resident passkey. A future associated-domain passkey can sit in front of the same session gate.

---

## 6. Protocol Packages (Real Implementations)

Each package exports:

```ts
export interface ProtocolHandler {
  brand: 'ledger' | 'trezor' | 'onekey';
  models: string[];
  handleWrite(data: Uint8Array): Promise<Uint8Array | null>; // null = no response yet
  getServiceUUID(): string;
  getCharacteristics(): { write: string; notify: string; writeCmd?: string };
}
```

### protocol-ledger
- Parse Ledger BLE framing (`0x05` + seq + len)
- Reconstruct full APDU
- Dispatch common APDUs (GET_VERSION, GET_APP_NAME, etc.)
- For signing APDUs: require passphrase entry + user confirmation on the phone UI, then sign with the unlocked seed using standard crypto libraries
- Reply with proper framed response + status words (`0x9000` success)

### protocol-trezor
- Implement THP L2 framing
- Implement Noise XX handshake (use audited Noise implementation, e.g. `@noble/curves` + AES-GCM)
- After encrypted channel is established, handle Protobuf messages
- This is the most complex package

### protocol-onekey
- Detect V1 vs V2 from first packets
- V1: parse `3F2323` header
- V2: handle chunked CRC framing
- Same seed-signing flow as above

**Important:** The phone UI must show clear signing confirmations (amount, address, etc.) before any signature is produced. Never auto-sign.

---

## 7. App Flow

1. **Unlock** — OS biometric / device passcode (debug skip in development)
2. **Device** — Pick a BLE model (`DeviceCard`), optional session passphrase, Start advertising
3. **Seed Vault** — Generate / import BIP39 or SLIP-39, HD inspect
4. **Host** — `yarn proxy` / CWS Proxy. USB HID gadget plus the **Testnet host** tab (Ledger / OneKey / Trezor catalogs over the phone BLE link). Signing still confirms on the phone.
5. **Signing Request** — `SigningModal` slide-to-confirm. ERC-20 tickers from PROVIDE_ERC20 are labeled host-provided.
6. **QR air-gap** — Export account UR / scan sign requests via `@cws/sdk` QR helpers
7. **Stop** — Stop advertising, `resetLink`, wipe session seed

---

## 8. Key Dependencies (apps/mobile)

```json
{
  "expo-crypto": "~14.0.0",
  "expo-secure-store": "~14.0.0",
  "expo-local-authentication": "~15.0.0",
  "munim-bluetooth": "latest",
  "@scure/bip39": "^1.4.0",
  "@noble/curves": "^1.6.0",
  "@noble/hashes": "^1.5.0"
}
```

---

## 9. Implementation Order for Cursor

1. Scaffold monorepo + contracts
2. Implement secure seed generation + SecureStore vault (with tests for entropy)
3. Build brand/model picker + seed UI
4. Integrate munim-bluetooth peripheral advertising (start with Ledger Nano X UUIDs)
5. Implement protocol-ledger (framing + basic APDUs + signing)
6. Add OneKey V1
7. Add Trezor THP (most complex)
8. Add remaining Ledger models (just UUID + name differences)
9. Passkey unlock layer
10. Polish UI + background service (Android)

---

## 10. Limitations & Honesty

- **BLE peripheral requires a physical phone.** Simulators and Expo Go cannot advertise GATT.
- **USB** is not emulated inside the phone. Desktop wallets that only speak HID use `apps/proxy` (Linux uhid / macOS CWS Proxy) as a local gadget that forwards to the phone over BLE.
- **iOS background BLE** is restricted. Keep the app in foreground. Notify MTU stays 20 on iOS.
- **BLE link is not LE Secure Connections.** Hosts still talk the vendor protocol once GATT is up.
- **Real devices have Secure Elements.** This is a software simulator. Treat it as a development/testing tool, not a replacement for a hardware wallet for large amounts.
- Host apps may perform extra checks (Genuine, certificates). Do not expect Ledger Live Genuine to pass.
- iOS has no `preventScreenCapture` equivalent to Android `FLAG_SECURE`. Release Android still sets FLAG_SECURE on Vault / secret screens; debug skips it so `adb screencap` QA can see the UI.

---

**Document version:** 1.3  
**Date:** 2026-10-27
