# YSK Cold Wallet Simulator — Architecture Document

**Project:** `ysk-cold-wallet-simulator`  
**Product:** YSK Cold Wallet Simulator (CWS), version 1.1.2 (build 8)  
**Publisher:** YSK Limited  
**Layout:** Expo TypeScript monorepo  
**Scope:** The phone acts as a Bluetooth hardware-wallet peripheral for selected Ledger, Trezor, and OneKey models. USB HID is bridged by `apps/proxy` and `packages/native-proxy`. Air-gap QR lives in `packages/protocol-qr`.  
**Platforms:** Android and iOS on a physical phone. Simulators and Expo Go cannot advertise BLE. iOS keeps the radio in the foreground.  
**Protocols:** The handlers speak the vendor formats. They are not brand apps and they are not endorsed by those vendors.

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

## 2. High-Level Architecture

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
2. Advertise the local name from `bleAdvertiseName` (short names such as `Nano X`, `Trezor Safe 7`, `K1234`)
3. Implement GATT server with the correct characteristics
4. Handle Write / WriteWithoutResponse → feed into protocol handler
5. Send Notify responses back to the connected host
6. Negotiate MTU where possible

**Android and iOS:** The phone advertises only while the app is on screen. The Android connected-device foreground service is removed, and iOS background modes are not set. Simulators and Expo Go cannot advertise BLE.

**BLE link:** This build does not use LE Secure Connections. A host that speaks the vendor protocol can continue after GATT is up. That is not a genuine-device attestation. Ledger Live’s genuine check is not expected to pass. Seeds are not absolutely safe. See `docs/security.md`.

---

## 4. Seed handling

This section describes the vault. It does not make a seed safe. **Seeds are not absolutely safe.** There is no secure element. The public statement is [`docs/security.md`](security.md).

### Entropy source

```ts
import * as Crypto from 'expo-crypto';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// 16 bytes = 12 words, 32 bytes = 24 words. Shown for transcription. Not stored as text.
const entropy = await Crypto.getRandomBytesAsync(wordCount === 12 ? 16 : 32);
const mnemonic = entropyToMnemonic(entropy, wordlist);
```

- `expo-crypto.getRandomBytesAsync` uses Android `SecureRandom` and iOS `SecRandomCopyBytes`.
- Do not use `Math.random`, a `crypto.getRandomValues` polyfill that falls back to an insecure source, or a WASM RNG that has been observed to return zeros on Android after the first call.
- Validate with `@scure/bip39`.

The vault stores entropy, or the SLIP-39 secret. It does not write the mnemonic to the clipboard.

### Storage

Use `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The web build refuses to store entropy (`saveSlot` throws).

```ts
await SecureStore.setItemAsync(key, base64Entropy, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});
```

`requireAuthentication` is not set on the entropy item. The Expo API would prompt on every read, and the app reads entropy while a host lists accounts. That prompt breaks account listing and fails under iPhone Mirroring. After the device is unlocked, the process can read the item without a fresh biometric. Release builds still ask the OS authenticator before reveal, import, save, sign, and seed export. That check is in the application, not a keychain access-control list. A debug build skips the reveal prompt. Sign and seed export on a debug build follow the Settings toggle.

- Android may wrap the app storage key in a hardware-backed keystore when the device has one. That is not a secure element, and it does not make the seed absolutely safe.
- iOS uses the keychain with device-unlocked accessibility. iOS does not black a live screenshot.
- A passphrase is not persisted. `SecretSession` keeps the derived seed in RAM. Host-supplied Trezor passphrases must surface on the signing chip (`passphraseSource: 'host'`) and must not silently override a device-applied seed.
- `crypto-seed` QR export requires `SigningModal` (`kind: 'export-seed'`). xpub / hdkey export may stay silent, matching GET_ADDRESS P1=0.

### Multiple Seeds

Each seed is a slot:
- `id` (UUID)
- `label` (user-defined)
- `brand` + `model` (for UI)
- `wordCount` (12 or 24)
- `createdAt`
- Entropy, or the SLIP-39 secret, in SecureStore under a unique key

---

## 5. App Unlock (local authentication)

This repo has **no associated domain**, so full WebAuthn passkeys are not used. Unlock is `expo-local-authentication` (OS biometric / device passcode) in `apps/mobile/src/passkeys/session.ts`.

**Flow:**

1. Disclaimer, then Unlock.
2. Release: OS biometric / passcode. Success unlocks a session (`autoLockMinutes`, default 15).
3. Debug builds skip the OS unlock prompt, Android `FLAG_SECURE`, and the new-seed verify quiz. Release builds keep all three.
4. Session expiry returns to `/unlock`. Passphrase overlay is wiped with `SecretSession`.

Unlock uses the OS authenticator. It is not a resident passkey.

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
- For signing APDUs: show the review and wait for press-and-hold, then sign. A passphrase is optional and stays in session memory.
- Reply with proper framed response + status words (`0x9000` success)

#### Reported app version

Settings → Ledger catalog. The version on a row is what a host reads for that open app:

- App `GET_VERSION` major, minor, and patch bytes (Cardano is `CLA 0xD7 INS 0x00`: those three bytes plus the existing flags byte).
- ASCII version in `GET_APP_AND_VERSION` (`CLA 0xB0 INS 0x01`).

Dashboard `GET_VERSION` (`CLA 0xE0 INS 0x01`) stays the device OS string. App name strings and flag bytes stay as this build already sends them. The pick is also the version the APDU handlers branch on when upstream changed the stage map. Cardano `SIGN_TX` is the case that cannot share one P1 table: 8.x and 7.x use the same P1 bytes for different stages. See `docs/ledger-apdu.md`. Choosing a version does not load that binary. A version component above 255 is omitted, because the 3-byte reply cannot carry it. The current Polymesh string `8.8000001.7` stays selectable as the snapshot default; `GET_APP_AND_VERSION` still sends that full string.

Update Ledger apps loads two public Ledger endpoints for the selected device, provider 1: `v2/apps/by-target` (the default reported version, same as before) and `/api/applications` (every published build). The pick is kept when that version is still in the new list. Before an update, each model uses the bundled list in `ledgerVersionIndex.json` (Nano X, Stax, Flex, Nano G5; snapshot 29 Oct 2026). Cardano `7.0.0` is on Ledger’s club provider and is not in that default catalog. `7.1.1` through `7.3.1` are, and an older host that rejects 8.x and recommends “7.0” accepts those 7.x builds.

QR air-gap does not speak Ledger `GET_VERSION`. The desktop proxy forwards HID to the phone, so the phone’s pick is what the HID host reads. The proxy fills an empty `GET_APP_AND_VERSION` from its own bundled catalog only when the phone reply has no version.

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

**Important:** The phone UI must show the review before any signature is produced. Never auto-sign. A decoded EVM transaction shows the chain, the called address, the native amount, gas, and nonce. Contract calldata that is not an exact ERC-20 transfer or approve stays raw, and amounts inside that calldata are not shown. That review is not Ledger clear signing and does not run an e0/32 simulation.

---

## 7. App Flow

1. **Unlock** — OS biometric / device passcode (debug skip in development)
2. **Device** — Pick a BLE model (`DeviceCard`), optional session passphrase, Start advertising
3. **Seed Vault** — Generate / import BIP39 or SLIP-39, HD inspect
4. **Host** — `yarn proxy` / CWS Proxy. USB HID gadget plus the **Testnet host** tab (Ledger / OneKey / Trezor catalogs over the phone BLE link). Signing still confirms on the phone.
5. **Signing Request** — `SigningModal` hold-to-confirm. Decoded EVM fields stay labeled. An exact ERC-20 transfer or approve shows the raw token amount; a PROVIDE_ERC20 ticker is labeled host-provided. Other calldata is not decoded. Long raw hex stays collapsed until it is expanded.
6. **QR air-gap** — Export account UR / scan sign requests via `@cws/sdk` QR helpers
7. **Stop** — Stop advertising, `resetLink`, wipe session seed

---

## 8. Dependencies

Declared versions live in each workspace `package.json`. The phone app uses Expo, `expo-secure-store`, `expo-local-authentication`, and `munim-bluetooth`. Cryptography uses `@noble/*` and `@scure/*`.

---

## 9. Limitations

The security statement for readers is `docs/security.md`. In short: seeds are not absolutely safe. This build has no secure element.

- **Proxy Bluetooth lock.** The desktop page lists compatible advertisers and connects only to the phone you pick. The choice is a peripheral id on this computer, not a seed. macOS needs Bluetooth permission for that copy of CWS Proxy. A rotated address or a new OS peripheral id will not match the saved lock. `cws-proxy --no-ui` without a lock file still auto-connects to the highest-ranked advertiser. RSSI is omitted when the stack does not report it.
- **BLE peripheral requires a physical phone.** Simulators and Expo Go cannot advertise GATT.
- **USB** is not emulated inside the phone. Desktop wallets that only speak HID use Linux `uhid` (`cws-proxy` from the Ubuntu package `hk.ysk.cws.proxy`, or `yarn proxy`) or the macOS CWS Proxy app. Virtual HID is not implemented on Windows. The gadget forwards to the phone over BLE.
- **Advertising stays in the foreground.** The Android connected-device foreground service is removed. iOS background modes are not set. Notify MTU stays 20 on iOS.
- **BLE link is not LE Secure Connections.** A host that speaks the vendor protocol can continue once GATT is up.
- **Real devices have secure elements.** This build does not. It is a simulator for development and interoperability testing. Do not hold real digital assets with it. Seeds are not absolutely safe.
- Host apps may perform extra checks (Genuine, certificates). Do not expect Ledger Live Genuine to pass.
- iOS has no `preventScreenCapture` equivalent to Android `FLAG_SECURE`. Release Android still sets FLAG_SECURE on Vault / secret screens; debug skips it so `adb screencap` QA can see the UI.

---

**Document version:** 1.1.0  
**Date:** 2026-10-29
