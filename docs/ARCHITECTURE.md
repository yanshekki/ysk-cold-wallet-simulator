# Cold Wallet Simulator — Architecture Document

**Project Name:** `cold-wallet-simulator`  
**Style:** ysk-kit (Expo TypeScript monorepo)  
**Scope:** BLE-only peripheral mode that mimics real Ledger / Trezor / OneKey hardware wallets.  
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
cold-wallet-simulator/
├── apps/
│   └── mobile/                 # Expo app (Android + iOS)
│       ├── app/                # Expo Router screens
│       ├── src/
│       │   ├── ble/            # Peripheral advertising + GATT server
│       │   ├── seeds/          # Secure seed vault
│       │   ├── passkeys/       # App unlock
│       │   └── protocols/      # Brand handlers (delegates to packages)
│       └── app.json
├── packages/
│   ├── contracts/              # Shared types (Brand, Model, SeedSlot, APDU, etc.)
│   ├── sdk/                    # High-level API used by the app
│   ├── ui/                     # Beautiful reusable components (seed cards, brand picker)
│   ├── protocol-ledger/        # Real Ledger APDU + BLE framing
│   ├── protocol-trezor/        # Real THP (Noise XX + framing)
│   └── protocol-onekey/        # Real V1 + V2
└── docs/
    └── ARCHITECTURE.md         # This file
```

**Principles:**
- Contracts first (types only)
- Protocol packages contain real protocol logic (no mocks)
- App owns BLE peripheral lifecycle + secure storage
- UI is presentation only

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

Use `expo-secure-store` with:

```ts
await SecureStore.setItemAsync(key, base64Seed, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,          // biometric gate on every read
  authenticationPrompt: 'Unlock seed',
});
```

- Android: Hardware-backed Keystore when available
- iOS: Keychain with biometric
- Passphrase is **never** persisted. User must enter it every time a seed is used for signing. Derive the final seed in memory only.

### Multiple Seeds

Each seed is a slot:
- `id` (UUID)
- `label` (user-defined)
- `brand` + `model` (for UI)
- `wordCount` (12 or 24)
- `createdAt`
- Encrypted seed blob in SecureStore under a unique key

---

## 5. Passkey Support (App Unlock — Most Secure Method)

Use platform authenticators via `react-native-passkey` (or `react-native-passkeys`).

**Recommended flow (local-only, no server required for app unlock):**

1. On first launch, user creates a passkey with `residentKey: required`, `userVerification: required`, `authenticatorAttachment: platform`.
2. The passkey private key stays in the platform secure enclave / Credential Manager.
3. To unlock the app (and thereby allow SecureStore biometric reads), the app performs a WebAuthn assertion against a local challenge.
4. Success → app is unlocked for a session (e.g. 5–15 minutes). Failure or timeout → re-lock.
5. Optional: combine with `expo-local-authentication` as a fallback, but prefer passkey as primary.

**Why this is strongest:**
- Private key never leaves the secure hardware
- Biometric / device PIN is enforced by the OS
- Resistant to app-level compromise better than simple biometric gating alone

**Note:** Full WebAuthn relying-party registration usually needs a domain + AASA / assetlinks. For pure local app unlock, use the library’s platform authenticator path carefully, or fall back to `expo-local-authentication` + SecureStore `requireAuthentication: true` if domain association is impractical. Document both options; implement the strongest that works without external infrastructure first.

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

1. **Unlock** — Passkey / biometric
2. **Brand & Model Picker** — Beautiful grid (Ledger / Trezor / OneKey models)
3. **Seed Vault** — List of seeds, generate new (12/24), import, delete (with confirmation)
4. **Start Simulation** — Begin advertising the selected model’s Service UUID
5. **Connected** — Show “Host connected” + live APDU/log view
6. **Signing Request** — Modal with details + passphrase entry + confirm/reject
7. **Stop** — Stop advertising, lock seeds

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
  "@noble/hashes": "^1.5.0",
  "react-native-passkey": "latest"
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

- **USB simulation is impossible** without root / custom kernel. This project is BLE-only.
- **iOS background BLE** is restricted. Recommend keeping the app in foreground.
- **Real devices have Secure Elements.** This is a software simulator. The security of the seed depends entirely on the phone’s Keystore/Keychain + biometric/passkey. Treat it as a convenient development/testing tool, not a replacement for a real hardware wallet for large amounts.
- Host apps may perform additional checks (firmware version, certificate, etc.). Start with the core transport + common APDUs; extend as needed when testing against real Ledger Live / Trezor Suite / OneKey apps.

---

**Document version:** 1.0  
**Date:** 2026-10-23  
**Ready for Cursor implementation.**
