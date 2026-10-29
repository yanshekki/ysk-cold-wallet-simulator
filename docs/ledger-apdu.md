# Ledger APDU wire matrix

Research date: 30 Oct 2026. This is the wire contract CWS claims for each open Ledger app. BLE and the desktop Proxy (HID) carry the same APDU. A host assertion such as `unexpected response length: 64 instead of 0` is on the response body after the status word is removed. An intermediate chunk that must continue is an empty body and `9000`. The confirm sheet opens only on the stage the real app uses for review.

The catalog pick is the version those bytes follow. `GET_VERSION` and `GET_APP_AND_VERSION` report that same pick. Where two app majors reuse one P1 for different stages, the handler branches. It does not load the firmware binary. Seeds are not absolutely safe.

Status values:

| Status | Meaning |
| --- | --- |
| MATCH | Body length, chunk ACK, and when the sheet opens follow the source cited for that row |
| FIXED | This change brought that row in line with the source |
| KEEP | Left as-is. The reason is in the row. A KEEP is not a silent success |

## Sources read for this pass

| App | What was read |
| --- | --- |
| Cardano 8.x | [LedgerHQ/app-cardano `doc/apdu_reference.md`](https://github.com/LedgerHQ/app-cardano/blob/develop/doc/apdu_reference.md) (develop, 30 Oct 2026) |
| Cardano 7.x and 8.x host | [@cardano-foundation/ledgerjs-hw-app-cardano](https://github.com/cardano-foundation/ledgerjs-hw-app-cardano) `src/validation/deviceCapabilities.ts` (`isV7App` is major ≤ 7, `isV8App` is major ≥ 8), `src/interactions/v7/signTx.ts`, `src/interactions/v8/commandBuilder.ts`, `src/Ada.ts` (`unexpected response length`) |
| Solana | [@ledgerhq/hw-app-solana](https://www.npmjs.com/package/@ledgerhq/hw-app-solana) `Solana.js` (`INS.SIGN = 0x06`, `P2_MORE = 0x02`, `P2_EXTEND = 0x01`, payload `[1][path][message]`) and [LedgerHQ/app-solana `src/apdu.h`](https://github.com/LedgerHQ/app-solana/blob/master/src/apdu.h) (`num_derivation_paths`) |
| Ethereum | [LedgerHQ/app-ethereum `doc/apdu.md`](https://github.com/LedgerHQ/app-ethereum/blob/develop/doc/apdu.md) and `@ledgerhq/hw-app-eth` `Eth.js` (`signTransaction` uses P1 `0x00` then `0x80`, P2 `0x00`) |
| Avalanche | [LedgerHQ/app-avalanche `docs/APDUSPEC.md`](https://github.com/LedgerHQ/app-avalanche/blob/develop/docs/APDUSPEC.md) |
| Bitcoin 2.1+ | [LedgerHQ/app-bitcoin `doc/bitcoin.md`](https://github.com/LedgerHQ/app-bitcoin/blob/develop/doc/bitcoin.md) |
| Aptos, TON | Firmware `src/constants.h` in aptos-labs/ledger-app-aptos and LedgerHQ/app-ton (CLA only; instruction tables were not in that header) |

NEAR, Tron, XRP, Stellar, Cosmos, Polkadot, and Sui rows below describe the handler that is already in this tree and the host packages it was written against. This pass did not re-read those firmware trees line by line. Gaps that were not re-checked are marked KEEP rather than MATCH.

## Transport

| Path | What differs | What does not |
| --- | --- | --- |
| Phone BLE | GATT framing (`05` sequence). The phone runs the handler | APDU bytes and response body length |
| Proxy HID | 64-byte HID reports. The proxy logs `hid <= apdu` before it writes BLE, then waits for a notify before `hid =>` | Same APDU. A missing `hid =>` means the phone never returned a status word |

`hidStatusWord` in the proxy only parses a status word when the HID length field is 2. Longer replies are still forwarded. The Raydium failure was not a dropped long reply. The first Solana chunk never got an empty `9000`, so the host did not send the rest and the phone had nothing complete to review.

## Dashboard routing

Empty probes still select an app when a wallet never sends Open App. A **data-bearing** `E0 06` or `E0 07` whose first bytes are a Solana path count plus `44'/501'` is Solana `SIGN_MESSAGE` / `SIGN_OFFCHAIN`, on the dashboard or on another app. Ethereum `E0 06` with an empty body stays `GET_APP_CONFIGURATION`.

| CLA / INS | Body | Reported app | Result | Status |
| --- | --- | --- | --- | --- |
| `E0 06` | empty | not Ethereum, XRP, or Stellar | Tron version (or Stellar if Tron is already open) | MATCH |
| `E0 06` | empty | Ethereum, XRP, or Stellar | that app's version | MATCH |
| `E0 06` / `E0 07` | Solana sign prefix with `44'/501'` | any app except Solana | switch to Solana and handle the chunk | FIXED |
| `E0 04` | empty | not Solana or TON | Solana version | MATCH |
| `E0 03` | empty | not TON | TON version | MATCH |

A Solana sign whose path is not `44'/501'` does not force a switch. The Solana app, once open, still accepts that payload. KEEP: non-default paths are not used as a dashboard probe.

## Cardano (`Cardano ADA`)

CLA `D7`. `GET_VERSION` (`INS 00`) is 4 bytes: major, minor, patch, flags `00`. Both majors use that layout. `INS 10` extended public key is 64 bytes (32-byte key and 32-byte chain code) on both.

`SIGN_TX` is `INS 21`. The host strips the status word and asserts the body length. The same P1 does not mean the same stage.

### 8.x (catalog default 8.0.8, and any major ≥ 8)

Source: app-cardano APDU reference and `V8TxP1` in the v8 command builder.

| P1 | Stage | Response body | Sheet | Status |
| --- | --- | --- | --- | --- |
| `10` | INIT | 0 | no | FIXED |
| `11` | CHUNK (non-final raw body) | 0 | no | FIXED |
| `12` | CONFIRM (final raw body) | 32 | yes, transaction review | FIXED |
| `0F` | SIGN_WITNESS (one BIP32 path) | 64 | yes, that witness | FIXED |
| `13` | CIP-36 auxiliary | host wants 0, or 96 on the last delegation | — | KEEP |

`0A` is not a v8 stage. It returns `6A86` and an empty body.

The 32-byte body is blake2b-256 of the uploaded raw chunks. The firmware hashes the canonical transaction body after it parses that buffer. CWS does not build that canonical encoding. A host that only checks the length proceeds. A host that compares the hash to its own transaction id will reject it. KEEP: canonical Cardano transaction hash. The witness signature is over the 32 bytes just returned, which is what the device signs, not over a hash CWS did not compute.

### 7.x (including a pick of 7.2.1; major ≤ 7)

Source: `src/interactions/v7/signTx.ts`. Every stage below returns an empty body except confirm and witness. `10` / `11` / `12` are **not** init, chunk, and confirm.

| P1 | v7 stage | Response body | Sheet | Status |
| --- | --- | --- | --- | --- |
| `01` | INIT | 0 | no | FIXED |
| `02`–`09`, `0B`–`0E` | inputs, outputs, fee, ttl, certificates, withdrawals, aux, validity start, mint, script data hash, collateral inputs, required signers | 0 | no | FIXED |
| `10` | total collateral | 0 | no | FIXED |
| `11` | reference inputs | 0 | no | FIXED |
| `12` | collateral output | 0 | no | FIXED |
| `13`, `15`, `16` | voting procedures, treasury, donation | 0 | no | FIXED |
| `0A` | CONFIRM | 32 | yes | FIXED |
| `0F` | WITNESS | 64 | yes, that witness | FIXED |
| `08` with P2 `34` | CIP-36 registration confirm | host wants 96 | — | KEEP, `6D00` |

The 32-byte v7 body is blake2b-256 of the concatenated stage payloads. That is not the firmware's transaction hash. Same KEEP as v8.

### Cardano commands that are not the Minswap send path

| INS | Upstream | CWS | Status |
| --- | --- | --- | --- |
| `11` DERIVE_ADDRESS | v8 P1 `01` returns raw address bytes; P1 `02` shows the address and returns an empty body | Always confirms and returns pubkey length, pubkey, address length, address text | KEEP. Address parameters are not a BIP32 path. Login uses `INS 10`, which is 64 bytes |
| `12` native script hash | multi-stage, final body 28 bytes | `6D00` | KEEP |
| `22` operational certificate | 64-byte signature | `6D00` | KEEP |
| `23` CIP-36 vote | chunk ACKs then hash and signature | `6D00` | KEEP |
| `24` CIP-8 message | init/chunk empty, confirm returns signature, pubkey, and address field | `6D00` | KEEP |
| `15` | not an instruction in the v7 or v8 INS table | `6D00` | FIXED. It used to be treated as a finished signature |

The old `P2 & 0x02` "more data" bit is not how either Cardano major chunks `SIGN_TX`. Using it made INIT (`P1 10`, `P2 00` on 8.x) look finished and return a 64-byte Icarus signature. That is the Minswap `64 instead of 0` failure.

## Solana

CLA `E0`. No P1 remap across the 1.x app in the sources above, so the handler does not branch on the Solana version string. `GET_VERSION` (`INS 04`) is 5 bytes: blind-sign flag, pubkey display mode, major, minor, patch.

| INS | P1 | P2 | Response body | Sheet | Status |
| --- | --- | --- | --- | --- | --- |
| `05` GET_PUBKEY | `00` silent, `01` display | `00` | 32 | only when P1 is `01` | MATCH |
| `06` SIGN_MESSAGE | `01` (host confirm) | `02` MORE on every chunk except the last; `01` EXTEND on every chunk except the first. Flags combine | 0 while MORE is set; 64 on the last chunk | only the last chunk | FIXED |
| `07` SIGN_OFFCHAIN | same chunk flags | same | 0 then 64 | last chunk | FIXED |
| `20` challenge, `21` trusted name, `22` dynamic descriptor | — | — | — | — | KEEP, `6D00` |

First-chunk data is `[numPaths][path…][message]`. Each path is a BIP32 depth and big-endian components. Continuation chunks are message bytes only. The signature is ed25519 over the message, not over a hash. The host currently sends one path; extra paths are skipped so the message offset stays correct, and only the first path is signed. KEEP: one signature for a multi-path request.

`P2` bit `02` is the more-data flag from hw-app-solana. It is not the Cardano rule, and it is not applied to Cardano.

## Ethereum and Avalanche C-Chain

CLA `E0` for Ethereum and for Avalanche C-Chain (the Avalanche app's own X/P commands use CLA `80`). Current `@ledgerhq/hw-app-eth` `signTransaction` always sends P2 `00` and splits with P1 `00` then `80`. It keeps the last response. The firmware also defines P2 `01` as "store only, return no data". CWS finishes when the RLP is complete, which is what that host sends. An incomplete chunk is an empty `9000` so the next chunk is sent. That is the behavior fixed in #43.

| INS | Role | Intermediate body | Final body | Sheet | Status |
| --- | --- | --- | --- | --- | --- |
| `06` | GET_APP_CONFIGURATION | — | 4 (flags, major, minor, patch) | no | MATCH |
| `02` | address | — | pubkey and address, chain code only if P2 is `01` | when P1 is `01` | MATCH |
| `04` | sign transaction | 0 until the RLP is complete | 65 (`v`, `r`, `s`) | when the RLP completes | MATCH |
| `08` | personal_sign | 0 until the declared length arrives | 65 | on the last byte of the message | MATCH |
| `0C` / `1A` / `1C` | EIP-712 | depends on the clear-sign stream | 65 on the sign | on the sign | MATCH for the hashed and JSON paths already tested |
| `34` | EIP-7702 | — | 65 | yes | MATCH |
| `22`, `32`, `36`, `38`, `3A` | domain name, simulation, safe account, gated signing, map entry | — | — | — | KEEP, not implemented. `12` / `16` / `1E` acknowledge and store nothing |

Avalanche CLA `80` follows `docs/APDUSPEC.md`:

| INS | P1 | Response body | Sheet | Status |
| --- | --- | --- | --- | --- |
| `00` | ignored | version, flags, target id | no | MATCH |
| `01` wallet id | `01` shows | 6 | when P1 is `01` | MATCH |
| `02` address | `01` shows | length-prefixed pubkey, hash, address | when P1 is `01` | MATCH |
| `04` SIGN_HASH | `01` init, `03` next, `02` last | 0 until the hash is confirmed, then the signature | on the hash the user has not yet approved | MATCH |
| `05` SIGN transaction, `06` SIGN message | `00` init, `01` add, `02` last | 0, including the last chunk | on the last chunk | MATCH |

The last `INS 05` / `06` chunk stores the hash and returns an empty `9000`. The signature is the later `INS 04` call. Returning the signature on the last payload chunk leaves Core waiting.

## NEAR

CLA `80`. Chunking uses P1 `80` for the last chunk, not a P2 more-bit. Earlier chunks are an empty `9000`. The sheet opens on the last chunk. The signature is ed25519 over sha256 of the Borsh transaction (or the NEP-413 / NEP-366 prefixed payload). Public keys are 32 bytes. `GET_VERSION` (`INS 06`) is 3 bytes. This matches the handler landed for near.com. This pass did not re-read app-near. KEEP: treat that as the current tree, not as a fresh firmware diff.

## Bitcoin

Two protocols, selected by CLA. The bytes do not overlap, so both stay enabled no matter which Bitcoin version is reported. A 2.1+ host sends CLA `E1` after it reads the version. An older host sends CLA `E0`.

| CLA | INS | Command | Response | Sheet | Status |
| --- | --- | --- | --- | --- | --- |
| `E1` | `00` | GET_EXTENDED_PUBKEY | xpub text | when display is requested | MATCH (IDs from `doc/bitcoin.md`) |
| `E1` | `02` | REGISTER_WALLET | empty or `E000` plus a client request | on the policy | MATCH for the policies tested |
| `E1` | `03` | GET_WALLET_ADDRESS | length-prefixed address | yes | MATCH |
| `E1` | `04` | SIGN_PSBT | signed PSBT, or `E000` then CLA `F8` INS `01` CONTINUE | on the PSBT | MATCH for a single-input PSBT that fits one APDU |
| `E1` | `05` | GET_MASTER_FINGERPRINT | 4 bytes | no | MATCH |
| `E1` | `10` | SIGN_MESSAGE | signature | yes | MATCH |
| `F8` | `01` | CONTINUE | next step or final body | — | MATCH |
| `E0` | `40` | legacy GET_WALLET_PUBLIC_KEY | pubkey and address | when P1 asks | MATCH |
| `E0` | `44` / `4A` | legacy input start / finalize | 0 | no | MATCH |
| `E0` | `48` | legacy untrusted hash sign | DER signature and a sighash byte | yes. The sheet says the hash is host-supplied | MATCH |
| `E0` | `4E` | legacy sign message | recoverable signature | yes | MATCH |

KEEP: wallet policies and PSBT merkle proofs beyond the cases in `family.test.ts` and `handler.test.ts`. A zero HMAC is named on the sheet; it is not a registered-policy proof.

## Other open apps

These handlers share a generic chunk rule: P2 bit `02` means more data, the first byte is a BIP32 depth, the sheet opens on the last chunk, and the last body is a signature. That rule is **not** used for Cardano or for Solana sign. It remains for the apps below. This pass did not re-read each firmware, so the rows are the in-tree contract plus an explicit KEEP where the generic rule is only a stand-in.

| App | CLA | Version INS | Sign INS | Final sign body | Status |
| --- | --- | --- | --- | --- | --- |
| Tron | `E0` | `06` (flags, major, minor, patch) | `04` | 65, keccak of the payload | KEEP the generic chunk rule until app-tron is diffed again. Pubkey export is silent (P1 forced to 0) |
| XRP | `E0` | `06` (3 bytes) | `04` | 65, double sha256 | KEEP, same generic chunk rule |
| Stellar | `E0` | `06` (hash-sign flag, major, minor, patch). An empty body selects this app from Tron | `04`, `08`, `0A`, `0C` | 64 | KEEP, same generic chunk rule. Confirm-on-address is P2 on the real app; export here stays silent |
| Cosmos | `55` | `00` | `02` | 65, sha256 | KEEP, same generic chunk rule |
| Polkadot | `F9` or `90` | `00` | `02` | 64 | KEEP. Zondax apps use their own chunk and scale encoding |
| TON | `E0` | `03` (and `01`) | `06`, `08`, `09` | 64 | KEEP. `04` with an empty body is the app name `TON`. `05` is a 32-byte public key and must not be signed. CLA matches LedgerHQ/app-ton `constants.h` |
| Aptos | `5B` | `00` | `0A`, `02` | 64 | KEEP. CLA matches aptos-labs/ledger-app-aptos `constants.h`. Instruction bytes were not in that header |
| Sui | `00` | `00` | `03`, plus the Mysten block protocol | block replies, not a raw 64-byte APDU | MATCH for the OKX/Mysten block exchange already tested. A second Sui version with a different block tag is not branched |

## What this pass changed

| Failure | Cause | Change |
| --- | --- | --- |
| Minswap send, `unexpected response length: 64 instead of 0` | `INS 21` treated a missing P2 more-bit as the end of the signature and returned 64 bytes on v8 INIT | v8 and v7 stage maps above. Tests cover both majors |
| Raydium / Solflare, no sheet, first `E0 06` chunk | Dashboard (and Ethereum) treated data-bearing `E0 06` as Ethereum `GET_APP_CONFIGURATION`. The path parser also read `numPaths` as a BIP32 depth | Route a `44'/501'` sign chunk to Solana. Parse `numPaths`, ACK an empty `9000` while P2 MORE is set, open the sheet on the last chunk |

## Retry

Reinstall the phone build that contains this handler. The Proxy only forwards APDUs. An old phone build still answers Cardano INIT with 64 bytes and still treats a Solana sign chunk as an Ethereum version.
