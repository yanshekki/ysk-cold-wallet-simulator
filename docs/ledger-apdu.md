# Ledger APDU wire matrix

**Phase 2 item 2 (KEEP re-diff follow-up):** Tron/XRP/Stellar/Cosmos/Polkadot/TON/Aptos handlers re-diffed against official firmware/hw-app; MATCH/FIXED only with citations + `family.test.ts` KEEP re-diff cases. Cardano operational certificate is MATCH. Cardano CIP-36, address, native script, and CIP-8, plus Solana multi-path, Bitcoin policy, and Eth clear-sign stream, stay KEEP.

**Phase 2 family map (follow-up to #49):** catalog/`inferLedgerFamily` remaps ethereum CHAIN, bitcoin-like, cosmos-like, polkadot-like, and `ethereum-plugin` names so Open App is not `unknown`. Remapped rows are **not** new wire MATCH/FIXED — only family routing changed.

**Phase 2 item 4 (unknown research):** catalog unknown 77→63 (#52) →54 (#53) →37 (this PR) via Eos/Hedera/NEO/Casper/Flare/Conflux/Binance/Waves then Aion/Aleo/Alephium/Sia/Ergo/Arweave/Flow/InternetComputer/Starknet/Hathor/Hive/Concordium/Symbol/Everscale/QRL/Ardor/FIO dedicated handlers (MATCH only proven VERSION/CONFIG shapes). Remaining 37 catalog-unknown in `ledger-apdu-plan.md`. Prior KEEP left unless proven.

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
| Aptos | [aptos-labs/ledger-app-aptos `src/types.h`](https://github.com/aptos-labs/ledger-app-aptos/blob/main/src/types.h) + [LedgerHQ/app-aptos `doc/COMMANDS.md`](https://github.com/LedgerHQ/app-aptos/blob/develop/doc/COMMANDS.md) |
| TON | [LedgerHQ/app-ton `src/types.h`](https://github.com/LedgerHQ/app-ton/blob/master/src/types.h) + [`doc/COMMANDS.md`](https://github.com/LedgerHQ/app-ton/blob/master/doc/COMMANDS.md) |
| Tron | [@ledgerhq/hw-app-trx `Trx.ts`](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledgerjs/packages/hw-app-trx/src/Trx.ts) |
| XRP | [@ledgerhq/hw-app-xrp `Xrp.ts`](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledgerjs/packages/hw-app-xrp/src/Xrp.ts) |
| Stellar | [@ledgerhq/hw-app-str `Str.ts`](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledgerjs/packages/hw-app-str/src/Str.ts) |
| Cosmos | [Zondax ledger-cosmos `app_main.h` / `process_chunk`](https://github.com/Zondax/ledger-cosmos/blob/master/app/src/common/app_main.h) |
| Polkadot | [Zondax ledger-polkadot `docs/APDUSPEC.md`](https://github.com/Zondax/ledger-polkadot/blob/master/docs/APDUSPEC.md) |

NEAR and Sui rows below describe the handler that is already in this tree and the host packages it was written against where a fresh firmware re-diff was not completed this pass. Tron, XRP, Stellar, Cosmos, Polkadot, TON, and Aptos were re-diffed 30 Oct 2026 against official LedgerHQ / Zondax / aptos-labs sources (see Other open apps); MATCH/FIXED there require the cited tests in `family.test.ts`.

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
| `22` operational certificate | 64-byte signature of KES ‖ issue counter ‖ KES period. Path is `m/1853'/1815'/0'/index'` | 64-byte Icarus signature after confirm | MATCH |
| `23` CIP-36 vote | chunk ACKs then hash and signature | `6D00` | KEEP |
| `24` CIP-8 message | init/chunk empty, confirm returns signature, pubkey, and address field | `6D00` | KEEP |
| `15` | not an instruction in the v7 or v8 INS table | `6D00` | FIXED. It used to be treated as a finished signature |

`INS 22` is one APDU. The device signs the KES public key, then the issue counter, then the KES period. That is the reverse of the APDU field order, and it is not a hash. A payload longer than 72 bytes, or bytes left after the path, returns `6B14`. A cut-short KES key, period, or issue counter returns `6B10`, `6B11`, or `6B12`. A path that does not parse returns `6B13`. A path that parses and is not a pool cold key returns `6982` and does not open a sheet. User rejection is `6985`. Source: LedgerHQ/app-cardano `doc/apdu_reference.md` §8.1, `src/opcert/opcert_parse.c`, and `src/handler/sign_opcert.c` (develop).

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

Family SIGN chunking is no longer one shared P2-bit-`02` rule for every app below. Each row cites the official chunk mode landed in this re-diff (`FamilyChunkMode` in `generic.ts`) plus remaining KEEP gaps.

| App | CLA | Version INS / body | Sign INS | Sign body | Status |
| --- | --- | --- | --- | --- | --- |
| Tron | `E0` | `06` (flags, major, minor, patch) | `04`, `05` (hash), `08` (message) | 65, keccak (hash INS uses 32-byte digest as-is) | FIXED chunking to hw-app-trx P1 startBytes (`10` single / `00` first / `80` mid / `90` last). Pubkey export stays silent (P1 forced to 0). KEEP: ECDH `0A` peer-key UX; TIP-712 |
| XRP | `E0` | `06` (flags + major/minor/patch = 4 bytes so host `response[1..3]` matches) | `04` | 65, double sha256 | FIXED chunking to hw-app-xrp P1 `(isFirst?0:1)|(hasMore?0x80:0)`. KEEP: ed25519 curve mask path (`P2 0x80`) not exercised in unit tests |
| Stellar | `E0` | `06` (hash-sign flag, major, minor, patch). Empty body still selects this app from Tron | `04`, `08`, `0A`, `0C` | 64 | FIXED chunking to hw-app-str P1 `00`/`80` + P2 `00`/`80`. Confirm-on-address is P2 on the real app; export here stays silent. KEEP: maxDataSize trailing bytes on newer GET_CONF |
| Cosmos | `55` | `00` → 9 bytes (`test|maj|min|patch|locked|target_id`) | `02` | 65, sha256 | FIXED version layout + Zondax P1 `0/1/2` chunk with fixed-5 path (no length byte) per `process_chunk`. KEEP: GET_ADDR HRP-prefixed request / pk|addr response without length prefixes (still length-prefixed BIP32 helper for hosts that send it) |
| Polkadot | `F9` or `90` | `00` → 12 bytes (u16 maj/min/patch layout) | `02`, `03` (raw) | 65 (`00`|ed25519 sig) | FIXED version + Zondax P1 chunk + 65-byte sig envelope per APDUSPEC. KEEP: SCALE/metadata proof parsing; SS58 prefix from path payload |
| TON | `E0` | `03` (and legacy `01`) | `06`, `08`, `09` | 98 = `len|sig64|len|hash32` | FIXED P2 first/more (`03`/`02`/`00`) + length-prefixed sig|hash per COMMANDS.md; `0A` GET_APP_SETTINGS returns `00`. KEEP: BOC/cell hash (hash field is sha256 of uploaded bytes, not parsed cell hash); proof/sign-data field parse |
| Aptos | `5B` | `03` (legacy `00` alias) | `06` (legacy `0A`/`02` aliases) | `len|sig` | FIXED INS table + P2 `0x80` more + path-only first chunk + pubkey `len|pk|len|chain` per COMMANDS.md / types.h. KEEP: none on core INS — chain_code is 32 zero bytes |
| Sui | `00` | `00` | `03`, plus the Mysten block protocol | block replies, not a raw 64-byte APDU | MATCH for the OKX/Mysten block exchange already tested. A second Sui version with a different block tag is not branched |

load |
| TON | `E0` | `03` (and legacy `01`) | `06`, `08`, `09` | 98 = `len|sig64|len|hash32` | FIXED P2 first/more (`03`/`02`/`00`) + length-prefixed sig|hash per COMMANDS.md; `0A` GET_APP_SETTINGS returns `00`. KEEP: BOC/cell hash (hash field is sha256 of uploaded bytes, not parsed cell hash); proof/sign-data field parse |
| Aptos | `5B` | `03` (legacy `00` alias) | `06` (legacy `0A`/`02` aliases) | `len|sig` | FIXED INS table + P2 `0x80` more + path-only first chunk + pubkey `len|pk|len|chain` per COMMANDS.md / types.h. KEEP: none on core INS — chain_code is 32 zero bytes |
| Sui | `00` | `00` | `03`, plus the Mysten block protocol | block replies, not a raw 64-byte APDU | MATCH for the OKX/Mysten block exchange already tested. A second Sui version with a different block tag is not branched |

## What this pass changed

| Failure | Cause | Change |
| --- | --- | --- |
| Minswap send, `unexpected response length: 64 instead of 0` | `INS 21` treated a missing P2 more-bit as the end of the signature and returned 64 bytes on v8 INIT | v8 and v7 stage maps above. Tests cover both majors |
| Raydium / Solflare, no sheet, first `E0 06` chunk | Dashboard (and Ethereum) treated data-bearing `E0 06` as Ethereum `GET_APP_CONFIGURATION`. The path parser also read `numPaths` as a BIP32 depth | Route a `44'/501'` sign chunk to Solana. Parse `numPaths`, ACK an empty `9000` while P2 MORE is set, open the sheet on the last chunk |
| Solflare swap, HID shows `e0/06` MORE then hangs, phone never opens sheet | CWS Proxy dropped an unarmed empty `9000` as "leftover" when `lastStatusSw` was already `9000` (race before `receiveArmed`). Solflare never got the MORE ACK, so it never sent the final chunk where the sheet opens | Hold-forward empty `9000` like `6d00`/`6e00` while awaiting; true post-settle leftovers still hit `!awaiting` |

## Retry

Reinstall the phone build that contains the Solana handler (routing + MORE ACK sheet on last chunk). Rebuild and restart **CWS Proxy** for the unarmed empty-`9000` hold-forward: that race lives in the desktop proxy, not on the phone. An old phone build still answers Cardano INIT with 64 bytes and still treats a Solana sign chunk as an Ethereum version.

## Catalog coverage (every Manager app)


Phase 1 expansion (30 Oct 2026). Every row in `LEDGER_MANAGER_SNAPSHOT` appears below. This table is the coverage checklist for the owner mandate. It does **not** claim handlers are complete. MATCH/FIXED/KEEP in sections above remain the wire-claim vocabulary for apps that were actually diffed; rows here use plan statuses when the firmware was not re-read.

See also [ledger-apdu-plan.md](./ledger-apdu-plan.md) for the catalog matrix and [full-vendor-parity-plan.md](./full-vendor-parity-plan.md) for the post-#55 backlog (unknown apps, open KEEP, Proxy races, Trezor, OneKey, QR). Seeds are not absolutely safe.

| App | Catalog family | Default version | Wire / plan status | Official INS summary |
| --- | --- | --- | --- | --- |
| 1inch | `ethereum-plugin` | 2.2.2 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Aeternity | `ethereum` | 0.4.5 | family remap ethereum (#52); wire via ethereum handler | family remap ethereum (#52); wire via ethereum handler |
| Aion | `aion` | 1.0.4 | MATCH GET_APP_CONFIGURATION (CLA E0 INS 06) 4-byte; pubkey/sign KEEP — LedgerHQ/app-aion | MATCH GET_APP_CONFIGURATION (CLA E0 INS 06) 4-byte; pubkey/sign KEEP — LedgerHQ/app-aion |
| Akroma | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Aleo | `aleo` | 1.4.0 | MATCH GET_VERSION (CLA E0 INS 03) 3-byte; address/sign/view-key KEEP — LedgerHQ/app-aleo | MATCH GET_VERSION (CLA E0 INS 03) 3-byte; address/sign/view-key KEEP — LedgerHQ/app-aleo |
| Aleph Zero | `polkadot` | 18.73.5 | family-mapped — catalog `polkadot` (reuses polkadot handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA F9/90: 00/01/02 (Zondax pattern) |
| Alephium | `alephium` | 0.4.7 | MATCH GetVersion (CLA 80 INS 00) 3-byte; pubkey/sign KEEP — LedgerHQ/app-alephium | MATCH GetVersion (CLA 80 INS 00) 3-byte; pubkey/sign KEEP — LedgerHQ/app-alephium |
| Algorand | `algorand` | 2.7.4 | MATCH GET_VERSION; pubkey/sign KEEP — LedgerHQ/app-algorand (#52) | MATCH GET_VERSION; pubkey/sign KEEP — LedgerHQ/app-algorand (#52) |
| Alkemi | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Angle | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Aptos | `aptos` | 0.10.2 | see Other open apps (FIXED INS/chunk) | CLA 5B: 03/04/05/06 (types.h + COMMANDS.md) |
| APWine | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Ardor | `ardor` | 1.1.1 | MATCH GET_VERSION (CLA E0 INS 01) 7-byte; sign/pubkey KEEP — LedgerHQ/app-ardor | MATCH GET_VERSION (CLA E0 INS 01) 7-byte; sign/pubkey KEEP — LedgerHQ/app-ardor |
| Ark | `unknown` | 2.3.1 | unknown — needs firmware research | unknown — needs firmware research |
| ArtBlocks | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| ARTIS sigma1 | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Arweave | `arweave` | 1.0.26 | MATCH GET_VERSION (CLA 44 INS 00) 5-byte Zondax; ADDR/SIGN KEEP — LedgerHQ/app-arweave | MATCH GET_VERSION (CLA 44 INS 00) 5-byte Zondax; ADDR/SIGN KEEP — LedgerHQ/app-arweave |
| Astar Polkadot EVM | `polkadot` | 1.22.5 | catalog polkadot; also listed in app-ethereum chain mk — confirm host CLA before claiming MATCH | CLA F9/90: 00/01/02 (Zondax pattern) |
| Atheios | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Avail | `polkadot` | 1.39.6 | family-mapped — catalog `polkadot` (reuses polkadot handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA F9/90: 00/01/02 (Zondax pattern) |
| Avalanche | `avalanche` | 1.4.22 | see Avalanche section (MATCH) | CLA 80: 00–06; plus E0 eth set |
| Babylon BTC Staking | `unknown` | 1.0.1 | unknown — needs firmware research | unknown — needs firmware research |
| Banano | `unknown` | 1.3.1 | unknown — needs firmware research | unknown — needs firmware research |
| Berachain | `ethereum-plugin` | 1.2.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Binance Chain | `binance` | 2.1.1 | MATCH VERSION/ADDR/SIGN; SHOW_ADDR KEEP — LedgerHQ/app-binance (#53) | MATCH VERSION/ADDR/SIGN; SHOW_ADDR KEEP — LedgerHQ/app-binance (#53) |
| Bitcoin | `bitcoin` | 2.5.1 | see Bitcoin section (MATCH/KEEP) | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Bitcoin Cash | `bitcoin` | 2.4.13 | bitcoin family — see Bitcoin section; coin params differ | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Bitcoin Gold | `bitcoin` | 2.4.13 | bitcoin family — see Bitcoin section; coin params differ | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Bitcoin Private | `bitcoin` | 2.4.13 | bitcoin family — see Bitcoin section; coin params differ | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Brick Towers | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Callisto | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Canton | `canton` | 3.5.1 | MATCH GET_VERSION (CLA E0 INS 03) 3-byte; pubkey/sign KEEP — LedgerHQ/app-canton `doc/APDU.md` | CLA E0: 03/04/05/06 |
| Cardano ADA | `cardano` | 8.0.8 | see Cardano section (MATCH/FIXED/KEEP) | CLA D7: 00/01/04/10/11/12/21/22/23/24 |
| Casper | `casper` | 3.1.9 | MATCH VERSION/ADDR/SIGN — LedgerHQ/app-casper (#53) | MATCH VERSION/ADDR/SIGN — LedgerHQ/app-casper (#53) |
| cBridge | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Celo | `unknown` | 1.8.3 | unknown — needs firmware research | unknown — needs firmware research |
| ChorusOne | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| CIAN | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Coinbase | `ethereum-plugin` | 2.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Concordium | `concordium` | 5.7.0 | MATCH Get app version (CLA E0 INS 40) 3-byte; other INS KEEP — LedgerHQ/app-concordium | MATCH Get app version (CLA E0 INS 40) 3-byte; other INS KEEP — LedgerHQ/app-concordium |
| Conflux | `conflux` | 2.2.2 | MATCH CONFIG/pubkey — LedgerHQ/app-conflux (#53) | MATCH CONFIG/pubkey — LedgerHQ/app-conflux (#53) |
| Core | `unknown` | 0.1.1 | unknown — needs firmware research | unknown — needs firmware research |
| Cosmos | `cosmos` | 2.39.2 | see Other open apps (FIXED version/chunk; KEEP GET_ADDR HRP) | CLA 55: 00/02/04 (Zondax app_main.h) |
| COTI | `unknown` | 1.3.1 | unknown — needs firmware research | unknown — needs firmware research |
| Cronos POS Chain | `cosmos` | 2.19.1 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| Dash | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Decred | `unknown` | 1.4.2 | unknown — needs firmware research | unknown — needs firmware research |
| Desmos | `cosmos` | 2.18.4 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| DEXON | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Digibyte | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Dogecoin | `bitcoin` | 2.4.13 | bitcoin family — see Bitcoin section; coin params differ | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| EigenLayer | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Elastos | `unknown` | 1.1.5 | unknown — needs firmware research | unknown — needs firmware research |
| Ellaism | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| EnergyWebChain | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| ENS | `ethereum-plugin` | 2.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Eos | `eos` | 1.6.1 | MATCH GET_APP_CONFIGURATION; pubkey/sign KEEP — LedgerHQ/app-eos (#53) | MATCH GET_APP_CONFIGURATION; pubkey/sign KEEP — LedgerHQ/app-eos (#53) |
| Ergo | `ergo` | 0.0.10 | MATCH GET_APP_VERSION (CLA E0 INS 01) 4-byte; xpub/addr/sign KEEP — LedgerHQ/app-ergo | MATCH GET_APP_VERSION (CLA E0 INS 01) 4-byte; xpub/addr/sign KEEP — LedgerHQ/app-ergo |
| Ether-1 | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Ethereum | `ethereum` | 1.22.5 | see Ethereum section (MATCH/KEEP) | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Ethereum Classic | `ethereum` | 1.22.5 | ethereum family — same CLA E0 INS as Ethereum; catalog family ethereum | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| EtherGem | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Ethersocial | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Everscale | `everscale` | 1.1.8 | MATCH GET_APP_CONFIGURATION (CLA E0 INS 01) 3-byte; pubkey/sign KEEP — LedgerHQ/app-everscale | MATCH GET_APP_CONFIGURATION (CLA E0 INS 01) 3-byte; pubkey/sign KEEP — LedgerHQ/app-everscale |
| Exchange | `unknown` | 4.4.4 | unknown — needs firmware research | unknown — needs firmware research |
| Expanse | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Factom | `factom` | 1.2.4 | MATCH GET_APP_CONFIGURATION (CLA E0 INS 06) flag\|\|major\|\|minor\|\|major; pubkey/sign KEEP — LedgerHQ/app-factom `handleGetAppConfiguration` | CLA E0: 02/04/06/08/10/12/14/16/18 |
| Fido U2F | `unknown` | 1.3.8 | unknown — needs firmware research | unknown — needs firmware research |
| Figment | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Filecoin | `filecoin` | 2.3.15 | MATCH Zondax VERSION/ADDR/SIGN; ETH dual path — LedgerHQ/app-filecoin (#52) | MATCH Zondax VERSION/ADDR/SIGN; ETH dual path — LedgerHQ/app-filecoin (#52) |
| FIO | `fio` | 1.0.9 | MATCH getVersion (CLA D7 INS 00) 4-byte; pubkey/sign KEEP — LedgerHQ/app-fio | MATCH getVersion (CLA D7 INS 00) 4-byte; pubkey/sign KEEP — LedgerHQ/app-fio |
| Firo | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Flare Network | `flare` | 2.6.7 | MATCH CONFIG — LedgerHQ/app-flare (#53) | MATCH CONFIG — LedgerHQ/app-flare (#53) |
| Flow | `flow` | 0.15.1 | MATCH GET_VERSION (CLA 33 INS 00) 5-byte Zondax; pubkey/sign KEEP — LedgerHQ/app-flow | MATCH GET_VERSION (CLA 33 INS 00) 5-byte Zondax; pubkey/sign KEEP — LedgerHQ/app-flow |
| GameCredits | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| GoChain | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Groestlcoin | `unknown` | 1.3.12 | unknown — needs firmware research | unknown — needs firmware research |
| Harmony | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Harvest | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Hathor | `hathor` | 1.1.2 | MATCH GET_VERSION (CLA E0 INS 03) 6-byte HTR||ver; addr/xpub/sign KEEP — LedgerHQ/app-hathor | MATCH GET_VERSION (CLA E0 INS 03) 6-byte HTR||ver; addr/xpub/sign KEEP — LedgerHQ/app-hathor |
| Hedera | `hedera` | 1.9.3 | MATCH GET_APP_CONFIGURATION; pubkey/sign KEEP — LedgerHQ/app-hedera (#53) | MATCH GET_APP_CONFIGURATION; pubkey/sign KEEP — LedgerHQ/app-hedera (#53) |
| Hive | `hive` | 1.1.2 | MATCH GET_VERSION (CLA D4 INS 06) 3-byte; pubkey/sign KEEP — LedgerHQ/app-hive | MATCH GET_VERSION (CLA D4 INS 06) 3-byte; pubkey/sign KEEP — LedgerHQ/app-hive |
| Horizen | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| HPB | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Hydra | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Hyperliquid | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| ICON | `unknown` | 1.0.9 | unknown — needs firmware research | unknown — needs firmware research |
| ID4Good | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| InternetComputer | `internetcomputer` | 4.2.17 | MATCH GET_VERSION (CLA 11 INS 00) 5-byte Zondax; ADDR/SIGN KEEP — Zondax/ledger-icp | MATCH GET_VERSION (CLA 11 INS 00) 5-byte Zondax; ADDR/SIGN KEEP — Zondax/ledger-icp |
| IOTA | `iota` | 1.0.4 | MATCH GET_VERSION (CLA 00 INS 00) triple\|\|`iota`; other INS and the block envelope KEEP — LedgerHQ/app-iota `docs/apdu.md` | CLA 00: 00/01/02/03/FF |
| IOTA Legacy | `unknown` | 0.5.9 | unknown — needs firmware research | unknown — needs firmware research |
| IoTeX | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| IOV | `cosmos` | 2.16.7 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| Kaspa | `kaspa` | 1.2.2 | MATCH GET_VERSION (CLA E0 INS 03) 3-byte; bad P1/P2 is 6A86; pubkey/sign KEEP — LedgerHQ/app-kaspa `src/types.h` | CLA E0: 03/04/05/06/07 |
| Kelp | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Kiln | `ethereum-plugin` | 2.2.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Komodo | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| LBRY | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Ledger Sync | `unknown` | 1.2.2 | unknown — needs firmware research | unknown — needs firmware research |
| Lens | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| libertify | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Litecoin | `bitcoin` | 2.4.13 | bitcoin family — see Bitcoin section; coin params differ | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| LTO Network | `lto` | 2.2.3 | MATCH GET_APP_CONFIGURATION (CLA 80 INS 06) 3-byte; pubkey/sign KEEP — LedgerHQ/app-lto `src/main.h` | CLA 80: 02/04/06 |
| MimbleWimble Coin | `unknown` | 7.7.0 | unknown — needs firmware research | unknown — needs firmware research |
| Mina | `mina` | 1.6.10 | MATCH GET_CONF; GET_ADDR/SIGN KEEP — LedgerHQ/app-mina (#52) | MATCH GET_CONF; GET_ADDR/SIGN KEEP — LedgerHQ/app-mina (#52) |
| Mix | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| MobileCoin | `unknown` | 0.16.3 | unknown — needs firmware research | unknown — needs firmware research |
| Monero | `unknown` | 2.2.4 | unknown — needs firmware research | unknown — needs firmware research |
| Moonbeam | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Moonriver | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Morpho | `ethereum-plugin` | 3.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| MultiversX | `multiversx` | 1.3.1 | MATCH VERSION + GET_ADDR; SIGN KEEP — LedgerHQ/app-multiversx (#52) | MATCH VERSION + GET_ADDR; SIGN KEEP — LedgerHQ/app-multiversx (#52) |
| Musicoin | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Namada | `namada` | 3.0.6 | MATCH GET_VERSION (CLA 57 INS 00) test\|\|u16 triple\|\|locked\|\|target id; addr/sign KEEP — LedgerHQ/app-namada `docs/APDUSPEC.md` | CLA 57: 00/01/02/03 |
| Nano | `unknown` | 1.3.1 | unknown — needs firmware research | unknown — needs firmware research |
| NEAR | `near` | 2.4.3 | see NEAR section (KEEP) | CLA 80: 00/02/04/05/06/07/08 |
| NEM | `unknown` | 0.0.13 | unknown — needs firmware research | unknown — needs firmware research |
| NEO | `neo` | 1.5.1 | MATCH GET_PUBLIC_KEY 65-byte P-256; SIGN KEEP — LedgerHQ/app-neo (#53) | MATCH GET_PUBLIC_KEY 65-byte P-256; SIGN KEEP — LedgerHQ/app-neo (#53) |
| NEO N3 | `neo` | 0.6.1 | MATCH GET_PUBLIC_KEY; SIGN KEEP — LedgerHQ/app-neo (#53) | MATCH GET_PUBLIC_KEY; SIGN KEEP — LedgerHQ/app-neo (#53) |
| Nervos | `nervos` | 0.6.3 | MATCH GET_VERSION (CLA 80 INS 00) 3-byte; pubkey/sign KEEP — LedgerHQ/app-nervos `src/apdu.c` CLA 0x80 | CLA 80: 00–07/09/0F |
| Nested | `ethereum-plugin` | 1.2.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Nimiq | `unknown` | 2.1.1 | unknown — needs firmware research | unknown — needs firmware research |
| NIX | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| NOS | `unknown` | 1.3.1 | unknown — needs firmware research | unknown — needs firmware research |
| Oasis | `cosmos` | 2.8.12 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| Oasys | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| OKX Web3 | `ethereum-plugin` | 1.1.1 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| ONT | `unknown` | 2.0.1 | unknown — needs firmware research | unknown — needs firmware research |
| Origin | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| P2P.org | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Paraswap | `ethereum-plugin` | 2.3.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Particl | `unknown` | 1.2.14 | unknown — needs firmware research | unknown — needs firmware research |
| Partisia Blockchain | `unknown` | 1.0.2 | unknown — needs firmware research | unknown — needs firmware research |
| peaq | `polkadot` | 1.1.6 | family-mapped — catalog `polkadot` (reuses polkadot handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA F9/90: 00/01/02 (Zondax pattern) |
| Peercoin | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Pepecoin | `unknown` | 2.0.4 | unknown — needs firmware research | unknown — needs firmware research |
| Persistence | `cosmos` | 2.18.0 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| Pirl | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| PivX | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Polkadot | `polkadot` | 100.0.30 | see Other open apps (FIXED version/chunk/sig) | CLA F9/90: 00/01/02/03 (APDUSPEC) |
| Polkadot Migration | `polkadot` | 100.0.27 | polkadot family — see Other open apps (FIXED; coin params may differ) | CLA F9/90: 00/01/02/03 (APDUSPEC) |
| Polymesh | `polkadot` | 8.8000001.7 | family-mapped — catalog `polkadot` (reuses polkadot handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA F9/90: 00/01/02 (Zondax pattern) |
| QRL | `qrl` | 1.1.5 | MATCH VERSION (CLA 77 INS 00) 4-byte; XMSS pubkey/sign KEEP — LedgerHQ/app-qrl | MATCH VERSION (CLA 77 INS 00) 4-byte; XMSS pubkey/sign KEEP — LedgerHQ/app-qrl |
| Qubic | `qubic` | 0.1.7 | MATCH GET_VERSION (CLA E0 INS 03) 3-byte; bad P1/P2 is 6A86; pubkey/sign KEEP — LedgerHQ/app-qubic `src/apdu/dispatcher.c` | CLA E0: 03/04/05/06 |
| QuickSwap | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Radix Babylon | `unknown` | 0.7.35 | unknown — needs firmware research | unknown — needs firmware research |
| Rarible | `ethereum-plugin` | 1.2.1 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Ravencoin | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Recovery Check | `unknown` | 1.5.5 | unknown — needs firmware research | unknown — needs firmware research |
| REOSC | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Ribbon | `ethereum-plugin` | 1.2.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Rocket Pool | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| RSK | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Secret | `cosmos` | 2.34.4 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| Security Key | `unknown` | 1.7.7 | unknown — needs firmware research | unknown — needs firmware research |
| Seed Tool | `unknown` | 1.8.4 | unknown — needs firmware research | unknown — needs firmware research |
| Sei | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Sei - Cosmos | `cosmos` | 1.1.2 | cosmos family — see Other open apps (FIXED version/chunk; KEEP GET_ADDR HRP) | CLA 55: 00/02/04 (Zondax app_main.h) |
| Shiden EVM | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Shimmer | `unknown` | 0.8.8 | unknown — needs firmware research | unknown — needs firmware research |
| Sia | `sia` | 2.2.1 | MATCH GET_VERSION (CLA E0 INS 01) 3-byte; pubkey/sign KEEP — LedgerHQ/app-sia | MATCH GET_VERSION (CLA E0 INS 01) 3-byte; pubkey/sign KEEP — LedgerHQ/app-sia |
| Solana | `solana` | 1.17.1 | see Solana section (MATCH/FIXED/KEEP) | CLA E0: 04/05/06/07 |
| Solar | `solar` | 1.3.1 | MATCH GET_VERSION (CLA E0 INS A2) 3-byte; name/sign KEEP — LedgerHQ/app-solar `doc/COMMANDS.md` | CLA E0: A1/A2/B1/B2/C1/C2 |
| Songbird | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Sonic | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Spacemesh | `spacemesh` | 0.0.16 | MATCH GET_VERSION (CLA 45 INS 00) test\|\|u16 triple\|\|locked; addr/sign KEEP — LedgerHQ/app-spacemesh `docs/APDUSPEC.md` | CLA 45: 00/01/02 |
| Spool | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Squid | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Stacks | `stacks` | 0.26.19 | MATCH VERSION/ADDR/SIGN — LedgerHQ/app-stacks (#52) | MATCH VERSION/ADDR/SIGN — LedgerHQ/app-stacks (#52) |
| Staderlabs | `ethereum-plugin` | 1.5.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| StakeDAO | `ethereum-plugin` | 1.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| StakeKit | `ethereum-plugin` | 1.5.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Starknet | `starknet` | 2.4.3 | MATCH GetVersion (CLA 5A INS 00) 3-byte; pubkey/tx KEEP — LedgerHQ/app-starknet | MATCH GetVersion (CLA 5A INS 00) 3-byte; pubkey/tx KEEP — LedgerHQ/app-starknet |
| Stellar | `stellar` | 6.1.0 | see Other open apps (FIXED chunk) | CLA E0: 02/04/06/08/0A/0C |
| Stratis | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Sui | `sui` | 1.5.13 | see Other open apps (MATCH for tested Mysten path; KEEP version branch) | CLA 00 block: 00/01/02/03 |
| Swell | `ethereum-plugin` | 2.1.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Symbol | `symbol` | 1.1.12 | MATCH GET_VERSION (CLA E0 INS 06) flags||ver 4-byte; pubkey/sign KEEP — LedgerHQ/app-symbol | MATCH GET_VERSION (CLA E0 INS 06) flags||ver 4-byte; pubkey/sign KEEP — LedgerHQ/app-symbol |
| TecraCoin | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Terra | `cosmos` | 1.2.2 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| Tezos Wallet | `unknown` | 3.2.4 | unknown — needs firmware research | unknown — needs firmware research |
| THORChain | `cosmos` | 2.5.2 | family-mapped — catalog `cosmos` (reuses cosmos handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA 55: 00/01/02/04 (Zondax pattern) |
| ThunderCore | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| TomoChain | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| TON | `ton` | 2.9.1 | see Other open apps (FIXED chunk/response; KEEP cell hash) | CLA E0: 03/04/05/06/08/09/0A (+ legacy 01) |
| Tron | `tron` | 0.7.10 | see Other open apps (FIXED chunk; KEEP ECDH/TIP-712) | CLA E0: 02/04/05/06/08/0A |
| Ubiq | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Uniswap | `ethereum-plugin` | 1.5.1 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| VeChain | `unknown` | 1.3.3 | unknown — needs firmware research | unknown — needs firmware research |
| Velora | `ethereum-plugin` | 2.5.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Venom | `unknown` | 1.1.8 | unknown — needs firmware research | unknown — needs firmware research |
| Vertcoin | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Viacoin | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| Wanchain | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Waves | `waves` | 1.2.2 | MATCH GET_APP_CONFIGURATION; pubkey/sign KEEP — LedgerHQ/app-waves (#53) | MATCH GET_APP_CONFIGURATION; pubkey/sign KEEP — LedgerHQ/app-waves (#53) |
| Webchain | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| Wethio | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| XAH | `unknown` | 1.1.1 | unknown — needs firmware research | unknown — needs firmware research |
| XDC Network | `ethereum` | 1.22.5 | family-mapped — catalog `ethereum` (reuses ethereum handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E0: 02/04/06/08/0A/0C/… (app-ethereum) |
| xRhodium | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |
| XRP | `xrp` | 2.8.2 | see Other open apps (FIXED chunk/version) | CLA E0: 02/04/06 |
| xx network | `polkadot` | 1.203.3 | family-mapped — catalog `polkadot` (reuses polkadot handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA F9/90: 00/01/02 (Zondax pattern) |
| Yearn | `ethereum-plugin` | 1.4.0 | blocked — Ethereum plugin; catalog family `ethereum-plugin` (not a standalone signer; hosts open Ethereum) | none — plugin |
| Zcash | `unknown` | 3.9.4 | unknown — needs firmware research | unknown — needs firmware research |
| ZClassic | `bitcoin` | 2.4.13 | family-mapped — catalog `bitcoin` (reuses bitcoin handler); not re-diffed this PR — no new MATCH/FIXED claim | CLA E1 00/02/03/04/05/10; F8 01; legacy E0… |

Catalog total: **205**. Catalog known-family: **23**. Catalog unknown: **182**. Rows with an official INS summary (not placeholder/plugin-none/unknown): **89**. Placeholder / plugin-none / unknown command rows: **116**.
