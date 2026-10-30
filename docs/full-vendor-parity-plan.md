# Full vendor parity plan

Research / plan date: 30 Oct 2026 (Asia/Hong_Kong). Tip at write time: `b421f7d` (#49–#55).

This document is the backlog after the Ledger catalog matrix in [ledger-apdu-plan.md](ledger-apdu-plan.md). Wire claims stay in [ledger-apdu.md](ledger-apdu.md). Trezor, OneKey, and QR notes that are already checked stay in [vendor-protocols.md](vendor-protocols.md).

**Seeds are not absolutely safe.** CWS has no secure element. Do not read a MATCH row as a claim that a seed is safe. See [security.md](security.md).

## Mandate

CWS mobile and CWS Proxy stay in lockstep. If the phone speaks a Ledger app, a vendor message, or a QR path that can also travel over HID or BLE, Proxy gets the transport and an adapter test in the same change. QR that never leaves the phone is phone-only until a later PR adds an explicit bridge.

MATCH and FIXED are allowed only when an official LedgerHQ, Zondax, Trezor, OneKey, Blockchain Commons BC-UR, or Keystone source is cited and a test checks the bytes. A family remap is not a wire MATCH. A `GET_VERSION` MATCH is not a signer. KEEP stays KEEP until that proof exists. Do not invent MATCH.

## What is already merged

| PR | Scope |
| --- | --- |
| #49 | Catalog matrix (205 Manager apps) |
| #50 | Family map for ethereum CHAIN, bitcoin-like, cosmos-like, polkadot-like, `ethereum-plugin` |
| #51 | KEEP re-diff: Tron, XRP, Stellar, Cosmos, Polkadot, TON, Aptos core INS and chunking |
| #52, #53, #55 | Unknown catalog cuts. Snapshot `family: 'unknown'` is **37** |
| #54 | Proxy hold-forward of an unarmed Solana SIGN MORE empty `9000` |

Counts when this plan was opened: 205 catalog apps, 168 with a known catalog family, 37 `unknown`. Version handlers for Canton, IOTA, Kaspa, Namada, Nervos, and Spacemesh move that unknown count to 31. Zcash stays unknown. A version MATCH is not a signer.

## Status words

| Word | Meaning |
| --- | --- |
| researched | Official or host command list is cited. KEEP gaps may remain in `ledger-apdu.md` |
| to-implement | A repo or command list is known. No handler MATCH is claimed |
| family-mapped | Catalog family points at an existing handler. Not a wire MATCH |
| blocked | No official command list yet. The search that failed is named |
| MATCH / FIXED / KEEP | Wire vocabulary in `ledger-apdu.md` only |

A 403 from an unauthenticated GitHub probe is not proof that a repository is missing. This pass used an authenticated lookup. Several rows that [ledger-apdu-plan.md](ledger-apdu-plan.md) marked blocked on a 403 are public repositories.

---

## 1. Ledger — remaining unknown catalog apps

The snapshot family stays `unknown` until an implementation PR changes it. The table below is the research status for the next PRs. SIGN stays KEEP even when `GET_VERSION` is listed: a version body is not a signature.

### Command list read this pass (still to-implement, not MATCH)

| App | Source read 30 Oct 2026 | Commands (not implemented here) |
| --- | --- | --- |
| Canton | [LedgerHQ/app-canton `doc/APDU.md`](https://github.com/LedgerHQ/app-canton/blob/main/doc/APDU.md) | CLA `E0`: `03` GET_VERSION (major, minor, patch); `04` GET_APP_NAME; `05` GET_PUBLIC_KEY (`len\|pk\|len\|chain`, 32+32); `06` SIGN_TX (P1 hash / untyped message / prepared tx; P2 first / more / message-end) |
| IOTA | [LedgerHQ/app-iota `docs/apdu.md`](https://github.com/LedgerHQ/app-iota/blob/main/docs/apdu.md) | CLA `00` block protocol: `00` GET_VERSION; `01` VERIFY_ADDRESS; `02` GET_PUBKEY; `03` SIGN_TX; `FF` QUIT_APP. P1 and P2 are `00` |
| Kaspa | [LedgerHQ/app-kaspa `src/types.h`](https://github.com/LedgerHQ/app-kaspa/blob/main/src/types.h) `command_e` | `03` GET_VERSION; `04` GET_APP_NAME; `05` GET_PUBLIC_KEY; `06` SIGN_TX; `07` SIGN_MESSAGE. Address types Schnorr, ECDSA, P2SH. `doc/APDU.md` on that repo is the generic BOLOS template, not the command list |
| Namada | [LedgerHQ/app-namada `docs/APDUSPEC.md`](https://github.com/LedgerHQ/app-namada/blob/main/docs/APDUSPEC.md) | CLA `57`: `00` GET_VERSION (test, u16 major/minor/patch, locked); `01` GET_ADDR; `02` SIGN (Zondax P1 init/add/last, path on the first chunk); `03` GET_KEYS; further spend-rand commands in the same file. A separate CLA `E0` INS `01` device-info shape is also documented |
| Nervos | [LedgerHQ/app-nervos `src/apdu.h`](https://github.com/LedgerHQ/app-nervos/blob/master/src/apdu.h) | `00` VERSION; `01` GET_WALLET_ID; `02` PROMPT_PUBLIC_KEY; `03` SIGN; `04` PROMPT_EXT_PUBLIC_KEY; `05` ACCOUNT_IMPORT; `06` SIGN_MESSAGE; `07` SIGN_MESSAGE_HASH; `09` GIT; `0F` SIGN_WITH_HASH. CLA is not in that header. Do not guess it |
| Spacemesh | [LedgerHQ/app-spacemesh `docs/APDUSPEC.md`](https://github.com/LedgerHQ/app-spacemesh/blob/main/docs/APDUSPEC.md) | CLA `45`: `00` GET_VERSION (test, u16 triple, locked); `01` GET_ADDR (32-byte key, no length prefix in the table); `02` SIGN (P1 init/add/last, path only on the first chunk); plus multisig, vesting, vault, and SIGN_MESSAGE in the same file |
| Zcash | [Zondax/ledger-zcash `docs/APDUSPEC.md`](https://github.com/Zondax/ledger-zcash/blob/main/docs/APDUSPEC.md) | CLA `85`: `00` GET_VERSION; `01` GET_ADDR_SECP256K1 (33-byte compressed key); Sapling address, diversifier, IVK, OVK, FVK, nullifier, and `INS_INIT_TX` / spend extraction later in the file. [LedgerHQ/app-zcash](https://github.com/LedgerHQ/app-zcash) also exists. Do not treat the Zondax CLA as the LedgerHQ app until those two trees are compared. Shielded commands are not a bitcoin-family remap |

### Repository exists; command bytes not extracted this pass

These stay **to-implement**. Do not copy a sibling app's CLA.

| App | What was found |
| --- | --- |
| Ark | [LedgerHQ/app-ark](https://github.com/LedgerHQ/app-ark) `src/main.c` |
| Babylon BTC Staking | [LedgerHQ/app-babylon](https://github.com/LedgerHQ/app-babylon) includes `bitcoin_client` and `src/commands.h` (included from `src/types.h`). Bitcoin-shaped staking. Not a bitcoin MATCH |
| COTI | [LedgerHQ/app-coti](https://github.com/LedgerHQ/app-coti) README only among the usual APDU paths |
| Decred | [LedgerHQ/app-decred](https://github.com/LedgerHQ/app-decred) `src/main.c` |
| Elastos | [LedgerHQ/app-elastos](https://github.com/LedgerHQ/app-elastos) `src/main.c` |
| Groestlcoin | [LedgerHQ/app-groestlcoin](https://github.com/LedgerHQ/app-groestlcoin) `src/main.c`. Groestl is not SHA256d. Do not remap onto the bitcoin handler as MATCH |
| IOTA Legacy | [LedgerHQ/app-iota-legacy](https://github.com/LedgerHQ/app-iota-legacy) `src/main.c` (archived `develop`). Not the IOTA CLA `00` table above |
| Monero | [LedgerHQ/app-monero](https://github.com/LedgerHQ/app-monero) README. The protocol is its own stream. A dedicated pass |
| Nano | [LedgerHQ/app-nano](https://github.com/LedgerHQ/app-nano) `src/main.c` |
| NEM | [LedgerHQ/app-nem](https://github.com/LedgerHQ/app-nem) `src/main.c` |
| Particl | [LedgerHQ/app-particl](https://github.com/LedgerHQ/app-particl) `src/main.c`. Bitcoin-adjacent README is not a bitcoin MATCH |
| Radix Babylon | [LedgerHQ/app-radix-babylon](https://github.com/LedgerHQ/app-radix-babylon) `src/types.h`. `doc/apdu.md` is the generic template. Archived [LedgerHQ/app-radix](https://github.com/LedgerHQ/app-radix) is a different tree |
| Shimmer | [LedgerHQ/app-shimmer](https://github.com/LedgerHQ/app-shimmer) `src/main.c`. IOTA-family sibling. Do not copy the IOTA table |
| Core | [LedgerHQ/app-core](https://github.com/LedgerHQ/app-core) `src/main.c` |
| Factom | [LedgerHQ/app-factom](https://github.com/LedgerHQ/app-factom) `src/main.c` |
| LTO Network | [LedgerHQ/app-lto](https://github.com/LedgerHQ/app-lto) `src/main.c` |
| MobileCoin | [LedgerHQ/app-mobilecoin](https://github.com/LedgerHQ/app-mobilecoin) `docs/apdu.md` points at [mobilecoinofficial ledger-mob APDU](https://mobilecoinofficial.github.io/ledger-mob/ledger_mob_apdu/index.html). The INS table is not in the repo file |
| Nimiq | [LedgerHQ/app-nimiq](https://github.com/LedgerHQ/app-nimiq) `src/main.c` |
| Pepecoin | [LedgerHQ/app-pepecoin](https://github.com/LedgerHQ/app-pepecoin) README only among the usual paths |
| Qubic | [LedgerHQ/app-qubic](https://github.com/LedgerHQ/app-qubic) `src/types.h`. `doc/APDU.md` is the generic template |
| Solar | [LedgerHQ/app-solar](https://github.com/LedgerHQ/app-solar) `doc/COMMANDS.md`. `doc/APDU.md` is the generic template |
| XAH | [LedgerHQ/app-xah](https://github.com/LedgerHQ/app-xah) `src/main.c`. `LedgerHQ/app-xrp-xah` is 404. Do not assume the XRP CLA `E0` table |

### Still no LedgerHQ app repository (blocked)

Searched 30 Oct 2026. HTTP 404:

| App | Search |
| --- | --- |
| Banano | `LedgerHQ/app-banano` 404. Do not copy Nano |
| Celo | `LedgerHQ/app-celo` and `celo-org/celo-ledger-app` 404 |
| ICON | `LedgerHQ/app-icon` 404 |
| MimbleWimble Coin | `LedgerHQ/app-mimblewimble-coin` 404 |
| NOS | `LedgerHQ/app-nos` 404 |
| ONT | `LedgerHQ/app-ontology` 404 |
| Partisia Blockchain | `LedgerHQ/app-partisia` and `LedgerHQ/app-partisia-blockchain` 404 |
| Venom | `LedgerHQ/app-venom` 404 |

Eight apps stay blocked. Twenty-nine of the original 37 unknown rows have a public repository. Canton, Kaspa, IOTA, Nervos, Namada, and Spacemesh have a GET_VERSION handler. Qubic, Solar, LTO Network, and Factom do too. Pubkey and SIGN on all of those stay KEEP. The other repositories in the tables below are still not MATCH.

## 1b. Ledger KEEP that is still open

Sources already cited in [ledger-apdu.md](ledger-apdu.md). Close a row only with a new test. Canonical encodings that CWS does not build stay KEEP.

| Area | Left open | Why it stays KEEP |
| --- | --- | --- |
| Cardano | v8 P1 `13` CIP-36 auxiliary; v7 P2 `34` CIP-36 registration (`6D00`) | [app-cardano APDU reference](https://github.com/LedgerHQ/app-cardano/blob/develop/doc/apdu_reference.md) describes them. Blocker: `aux_data_hash_builder` / CIP-36 registration CBOR is not built. Shelley and Byron `DERIVE_ADDRESS`, and CIP-8 Shelley address fields, are MATCH |
| Cardano hash | pool registration, voting procedures, CIP-36 aux type 1, and app versions before 2.2 | v8 and v7 2.2 through 7.2.1 body hashes are FIXED (`cardanoTxHash.test.ts`, `cardanoTxV7.test.ts`) from [tx_hash_builder.c](https://github.com/LedgerHQ/app-cardano/blob/main/src/transaction/tx_hash_builder.c) and ledgerjs v7 `signTx.ts`. Minswap 7.2.1 is included |
| Solana | INS `21` / `22` trusted name and dynamic descriptor | `6D00`. Blocker: `tlv_use_case_trusted_name` plus a Ledger PKI signature in `handle_provide_trusted_info.c`. INS `20` and `numPaths == 1` are MATCH |
| Solana dashboard | Only `44'/501'` forces a switch | Other paths are accepted once Solana is open. They are not a probe |
| Bitcoin | Wallet-policy HMAC and PSBT merkle proofs beyond `family.test.ts` and `handler.test.ts` | [app-bitcoin `doc/bitcoin.md`](https://github.com/LedgerHQ/app-bitcoin/blob/develop/doc/bitcoin.md). Blocker: `walletHmac` uses the CWS key `CWS/ledger-wallet-hmac`, not the app-bitcoin policy key. A zero HMAC stays host-unproven. CLA `F8` INS `01` has an unarmed hold-forward test |
| Ethereum | INS `22` `32` `36` `38` `3A` (domain, simulation, safe account, gated signing, map entry) | [app-ethereum `doc/apdu.md`](https://github.com/LedgerHQ/app-ethereum/blob/develop/doc/apdu.md). hw-app-eth `Eth.ts` sends only `22` (`provideDomainName`) from this set. Blocker: the TLV is CAL-signed. Empty `9000` would accept an unsigned domain. `32` / `36` / `38` / `3A` are not written by that host package. All five stay `6D00`. `12` / `16` / `1E` acknowledge and store nothing |
| Tron | sign-by-hash setting word `6A8C` | ECDH `0A` and TIP-712 `0C` are MATCH. [app-tron `ui_globals.c`](https://github.com/LedgerHQ/app-tron/blob/develop/src/ui/ui_globals.c). CWS does not model the off switch, so `E_MISSING_SETTING_SIGN_BY_HASH` is not returned |
| XRP | ed25519 when P2 is `80` | [app-xrp `sign_transaction.c`](https://github.com/LedgerHQ/app-xrp/blob/develop/src/apdu/messages/sign_transaction.c). Blocker: `cx_eddsa_sign` is SHA-512 over `STX\0` ‖ tx and the body is 64 bytes, but `bip32_derive_init_privkey_256(CX_CURVE_Ed25519)` lives in the SDK. CWS will not sign that path with SLIP-10 until that HDW call is copied |
| Cosmos | length-prefixed GET_ADDR helper | HRP requests are MATCH (`pk` ‖ bech32, no length prefixes) from [hw-app-cosmos](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledgerjs/packages/hw-app-cosmos/src/Cosmos.ts) and `crypto_fillAddress`. A length-prefixed BIP32 body is still accepted for older hosts |
| Polkadot | SCALE / metadata proof; SS58 prefix taken from the payload | Blocker: the Zondax [APDUSPEC](https://github.com/Zondax/ledger-polkadot/blob/master/docs/APDUSPEC.md) metadata proof is not parsed |
| TON | BOC / cell hash; proof and sign-data fields | Blocker: [app-ton COMMANDS](https://github.com/LedgerHQ/app-ton/blob/master/doc/COMMANDS.md). The hash field is sha256 of the uploaded bytes, not a parsed cell hash |
| NEAR | Fresh firmware diff | The handler matches the near.com path already in the tree. This pass did not re-read app-near |
| Sui | A second block-tag version | The OKX / Mysten exchange already tested is MATCH. A different tag is not branched |
| Newer families (#52–#55) | Pubkey and SIGN | VERSION or CONFIG is MATCH. SIGN is KEEP: Aion, Aleo, Alephium, Algorand (HDW_NORMAL Ed25519 is not SLIP-10), Ardor, Arweave (RSA), Concordium, Conflux, Eos (WIF and stream), Ergo, Everscale, FIO, Filecoin raw and personal, Flare address and sign, Flow, Hathor, Hedera, Hive, Internet Computer address and sign, Mina (secp field), MultiversX sign, NEO sign and GET_SIGNED_PUBLIC_KEY, QRL (XMSS), Sia, Stacks auth / JWT / fingerprint, Starknet pubkey and tx, Symbol, Tezos Micheline, Waves (Curve25519), Binance SHOW_ADDR, VeChain SIGN_CERTIFICATE `09` |

Ethereum clear-signing plugins stay blocked as standalone apps. Hosts open Ethereum. CWS does not implement plugin IPC. Manager utilities (Exchange, Fido U2F, Security Key, Seed Tool, Recovery Check, Ledger Sync) stay blocked as coin signers.

---

## 2. Proxy — HID / BLE status races

BLE and Proxy HID carry the same APDU. The phone runs the handler. The proxy must not drop the status word that lets the host send the next chunk.

#54: a Solana SIGN MORE empty `9000` can arrive before `receiveArmed` is true, because the phone ACKs while the BLE write is still resolving. `lastStatusSw` was already `9000`, so the proxy treated the ACK as a leftover and dropped it. Solflare never sent the last chunk. The sheet never opened. The fix hold-forwards `6D00`, `6E00`, and an unarmed empty `9000` that matches `lastStatusSw`, while `awaiting` is still true. A reply that arrives after settle still hits `!awaiting` and is dropped. See `apps/proxy/src/adapters/ledger.ts`.

### Adapter tests that already exist

`apps/proxy/src/adapters.test.ts` covers: unarmed `6D00` (TON GET_VERSION), `6D00` after a `9000`, a second unarmed `6D00`, a TON version `9000` before the write resolves, a lone `6E00` hold, an unarmed Open App `9000` after QUIT, an unarmed Solana SIGN MORE `9000` after a prior empty OK, a leftover drop when not awaiting, GET_APP_AND_VERSION on another channel, an all-zero HID probe, a GET_APP echo patch, and a duplicated BLE sequence.

### Multi-chunk paths without a dedicated hold-forward test

The phone handler already ACKs these with an empty `9000`. The proxy rule is the same as #54. The adapter test is missing.

| Path | Chunk rule | Source |
| --- | --- | --- |
| Ethereum SIGN | P1 `00` then `80`, empty body until the RLP completes | app-ethereum; fixed on the phone in #43. Proxy hold-forward test added |
| Cardano v8 INIT / CHUNK | P1 `10` / `11`, body length 0 | app-cardano. Proxy hold-forward test covers INIT |
| Avalanche CLA `80` SIGN / SIGN_MSG | last chunk is empty `9000`; the signature is the later INS `04` | app-avalanche APDUSPEC. Proxy hold-forward test covers SIGN init |
| Aptos SIGN | P2 `80` more | app-aptos COMMANDS. Proxy hold-forward test added |
| Cosmos, Polkadot, Filecoin, Casper, Stacks, Binance | Zondax P1 `0` / `1` / `2` | Zondax `process_chunk`. Proxy hold-forward test covers Cosmos init. The other Zondax apps share that ACK shape |
| Tron, XRP, Stellar, TON | family chunk modes in `generic.ts` | Proxy hold-forward test covers XRP P1 more. Tron, Stellar, and TON use the same empty-`9000` hold |
| NEAR | P1 `80` marks the last chunk; earlier chunks are empty `9000` | Proxy hold-forward test covers the mid-chunk |
| Bitcoin CONTINUE | CLA `F8` INS `01` | app-bitcoin `doc/bitcoin.md`. Unarmed empty-`9000` hold-forward test added |

`hidStatusWord` only parses a status word when the HID length field is 2. A longer body is forwarded as a whole frame. The race that matters is the **empty** status, which is what a multi-chunk ACK is.

### OneKey and Trezor transports

`attachOneKey` (`apps/proxy/src/adapters/onekey.ts`) forwards each completed HID message and each BLE notify. It has no `receiveArmed` leftover drop. A V2 chunk that is not yet a full frame stays inside `OneKeyUsbBleBridge`. The adapter test today is a V1 Initialize and a V2 ping, not a multi-chunk sign.

`attachTrezor` queues one USB protobuf at a time and writes the THP reply. There is no unarmed-status drop. The adapter test is a handshake to Features. THP sequence bits live in the phone handler.

Neither adapter has the #54 bug in its current shape. A future change that drops a short success while a write is in flight must add the same hold-forward test.

### Rule

Every multi-chunk path has both of these before it is called MATCH:

1. A protocol-package test for the empty ACK and for the sheet opening on the last chunk.
2. When the bytes can be sent through Proxy, an `adapters.test.ts` case that delivers that ACK before `receiveArmed` (Ledger) or before the USB write resolves (OneKey / Trezor), and expects the host to receive it.

A new Ledger or vendor command that can go through Proxy does not merge without (2).

There is no QR bridge in the proxy. Account UR and animated sign QR stay on the phone.

---

## 3. Trezor, OneKey, and `packages/protocol-*`

Checked 30 Oct 2026 against current upstream. Protobuf **field** layouts are not re-decoded here. A matching message id with a wrong field still fails the host. That remains KEEP until a host trace shows the field.

### Trezor

Ids in `packages/protocol-trezor/src/messages.ts` were compared with [trezor-firmware `MessageType.py`](https://github.com/trezor/trezor-firmware/blob/main/core/src/trezor/enums/MessageType.py) and [messages-thp.proto](https://github.com/trezor/trezor-firmware/blob/main/common/protob/messages-thp.proto).

Implemented on the phone, and forwarded by Proxy USB / trezord when the host uses them:

- THP code-entry pairing: 1008–1010 and 1018–1028, plus `ThpCreateNewSession` 1000.
- Features, Ping, Cancel, ButtonAck.
- Ethereum address, public key, legacy sign, EIP-1559 sign, typed data, typed hash.
- Bitcoin address, public key, sign message, and a simplified `SignTx` (the cases in the handler tests).
- Cardano address and a short sign stream: Init, Input, Output, HostAck **317** (device supplement 314 is not the finish ack; #48).
- Coin ops: Solana address / public key / sign tx, Ripple, Stellar address and sign tx, Tezos address and sign tx, Binance address and sign tx.

KEEP, present upstream and not implemented:

| Id | Name | Note |
| --- | --- | --- |
| 1011 | `ThpPairingPreparationsFinished` | Device → host after `ThpSelectMethod` when the method is not code entry |
| 1032 / 1033 | `ThpQrCodeTag` / `ThpQrCodeSecret` | QR pairing. Safe 7 may offer it. Not implemented |
| 1040 / 1041 | `ThpNfcTagHost` / `ThpNfcTagTrezor` | NFC pairing. The phone has no NFC pairing path |
| 60, 65 | `EthereumTxAck`, `EthereumVerifyMessage` | Not in the CWS id table |
| 471 / 472 | `EthereumDefinitionRequest` / `Ack` | Clear-sign definitions |
| 906–908 | Solana sign message, signature, verify | CWS Solana on Trezor is address, public key, and sign tx only |
| 203, 210–241 | Stellar operation stream and Soroban auth | CWS answers `StellarSignTx` 202 as one coin op, not the op-by-op stream |
| 323–341 | Cardano assets, certificates, withdrawals, mint, collateral, reference inputs, native script, CIP-8 sign message | The short stream does not accept these |
| 67–76 | NEM | Not implemented |
| 501–557 | Monero | Not implemented. Ledger app-monero is a separate backlog |
| 600–605 | EOS | Not implemented |
| 2001–2004 | Nostr | Not implemented |
| 2200–2213 | Tron | Trezor ids. OneKey uses 10501. Do not mix them |
| 2100–2107 | Evolu | Not implemented |

Binance 700 / 701 / 704 / 709 are **absent** from current `MessageType.py`. CWS keeps them for older hosts. They are not claimed against today's enum. Same note as [vendor-protocols.md](vendor-protocols.md).

Device-management ids (wipe, recovery, firmware upload, authenticity, brightness) are out of scope. CWS is not Trezor Suite and does not pretend to be a genuine device.

Proxy acceptance for a Trezor change: `attachTrezor` or `trezord` test when the message can arrive as USB HID. Phone BLE uses the same handler.

### OneKey

Ids in `packages/protocol-onekey/src/messages.ts` were compared with [OneKeyHQ/firmware-pro `MessageType.py`](https://github.com/OneKeyHQ/firmware-pro/blob/main/core/src/trezor/enums/MessageType.py).

Already matched and implemented, including the OneKey ranges: Solana 10100 (not Trezor 904), Tron 10501, Aptos 10600, Near 10701, Cosmos 10800, Polkadot 11000, Sui 11100, Ton 11901, `SignPsbt` 10052, `OnekeyGetFeatures` 10025, Ethereum OneKey 20100–20105 and 20108–20117, SE cert 10007. Cardano host ack is 317. V1 magic `3F2323` and V2 chunked frames both switch in the handler. Proxy `attachOneKey` wraps USB HID for V1 and V2.

Present in firmware-pro and **missing** from the CWS id table (to-implement only if the OneKey app sends them; otherwise KEEP):

| Ids | Name |
| --- | --- |
| 20106 / 20107 | `EthereumTxRequestOneKey` / `EthereumTxAckOneKey` |
| 20109 | `EthereumVerifyMessageOneKey` |
| 20118 / 20119 | Gnosis Safe tx |
| 20120 | `EthereumSignTxEIP7702OneKey` |
| 10106 | `SolanaSignUnsafeMessage` |
| 10606 | `AptosSignSIWAMessage` |
| 11106 / 11107 | `SuiTxRequest` / `SuiTxAck` |
| 10900–10903 | Algorand |
| 11200–11203 | Filecoin |
| 11300–11305 | Kaspa |
| 11400–11405 | Nexa |
| 11500–11509 | Nostr |
| 11600–11601 | LNURL auth |
| 11701–11706 | Nervos |
| 11905–11909 | TON proof, tx ack, sign data |
| 12001–12007 | SCDO |
| 12101–12110 | Alephium |
| 12201–12208 | Benfen |
| 12301–12304 | Neo |
| 10300–10308 | Starcoin |
| 10112–10119 | Conflux |
| 700–709 | Binance (still in OneKey firmware-pro; not in current Trezor `MessageType.py`) |
| 350 / 351 | `CardanoSignMessage` / `CardanoMessageSignature` (OneKey numbering; Trezor uses 338–341) |

NEM, EOS, and the Monero transaction stream are in firmware-pro and not in the CWS OneKey table. Same KEEP rule: no MATCH without a host trace and a test.

Proxy acceptance: a new OneKey message that the desktop app sends over USB needs an `attachOneKey` test, including a V2 multi-chunk frame when the message does not fit one report.

---

## 4. QR, animated QR, Keystone, UR, BC-UR

Account export and scan-to-sign run on the phone (`packages/protocol-qr`, `packages/sdk/src/qr.ts`, `QrAirgapSession`). Fountain encoding uses `@ngraveio/bc-ur`. BBQR is the Coldcard multipart format. The proxy does not encode or scan UR.

Checked against [KeystoneHQ/ur-registry `RegistryType.ts`](https://github.com/KeystoneHQ/ur-registry/blob/master/src/RegistryType.ts) and the tests already named in [vendor-protocols.md](vendor-protocols.md).

| UR | Registry | CWS | Status |
| --- | --- | --- | --- |
| `crypto-hdkey` | tag 303 | account export | MATCH |
| `crypto-account` | tag 311 | single account | MATCH |
| `crypto-multi-accounts` | tag 1103 | multi-account | MATCH |
| `crypto-output` | tag 308 | output descriptor | MATCH |
| `crypto-psbt` | tag 310 | PSBT sign | MATCH |
| `eth-sign-request` / `eth-signature` | Keystone ETH registry (not the core file) | data types 1–4 (tx, typed data, personal, typed tx) | MATCH, `ethSign.test.ts`, mobile session |
| `sol-sign-request` / `sol-signature` | Keystone SOL registry | request id, sign data, path, origin | MATCH, `chainSign.test.ts`, mobile session |
| `cosmos-sign-request` / `cosmos-signature` | Keystone Cosmos registry | MATCH, mobile session |
| `btc-sign-request` / `btc-signature` | Keystone BTC message | MATCH, mobile session |
| BBQR file type `P` and `U` | Coldcard | PSBT sign and xpub export | MATCH |

Animated QR is the fountain multipart encoder (`encodeFountainParts`). It is already what the phone shows for a long UR. A later PR extends tests when a new UR type is added. It does not replace the encoder.

KEEP, in the Keystone core registry, no encoder here: `uuid` (tag 37 is used *inside* ETH/SOL requests, not as a top-level UR), `bytes`, `crypto-keypath` (tag 304 is used inside an ETH path, not as its own UR), `crypto-coin-info`, `crypto-eckey`, `crypto-psbt-extend`, `qr-hardware-call`, `key-derivation-call`, `key-derivation-schema`, `derive-context-hash-call`. `crypto-seed` is a CWS export name. It is not a type in that core file. Export still requires the on-device confirm. The QR contains the secret.

Solana QR and EVM QR in this tree:

- Export: `crypto-hdkey` and, on Keystone / OneKey / AirGap profiles, `crypto-multi-accounts` and `crypto-account`.
- Sign: `sol-sign-request` and `eth-sign-request`, including animated parts.
- Not claimed: a Solana account UR type other than `crypto-hdkey` / `crypto-account`, or an EVM typed-data variant the ETH registry adds after the four data types above. Those stay KEEP until the Keystone registry file is cited and a round-trip test exists.

Proxy acceptance for QR work is **N/A** unless a PR explicitly adds a bridge. Phone acceptance is a `protocol-qr` test plus the `QrAirgapSession` path in `@cws/sdk` when the phone scans it. Seed export stays behind confirmation.

---

## 5. Phased backlog

Each phase is its own pull request, squash-merged to `main`. Batch size follows #52–#55: one family, or about eight to sixteen apps. Mobile and Proxy acceptance are both required when the bytes can cross the proxy.

### Phase 0 — this document

Docs only. No handler change. No USB install. No Proxy rebuild.

### Phase 1 — Proxy multi-chunk hold-forward

**Status.** The seven chunk shapes in section 2 have an `adapters.test.ts` hold-forward case (Ethereum, Cardano v8 INIT, Avalanche SIGN, Aptos, Cosmos, XRP, NEAR), on top of the Solana case from #54. Bitcoin CONTINUE is still catalog-only.

**Goal.** Adapter tests for every empty-`9000` path in the table in section 2.

**Mobile.** No handler change unless a test shows the phone ACK is wrong. If the phone changes, ship the Proxy test in the same PR.

**Proxy.** `adapters.test.ts` cases: Ethereum SIGN intermediate `9000`, Cardano v8 INIT `9000`, Avalanche last SIGN `9000`, Aptos P2 more, one Zondax family (Cosmos), one P1 family (XRP or Tron), NEAR mid-chunk `9000`. Same hold rule as #54. Do not drop a real leftover after settle.

**Tests.** `yarn workspace @cws/proxy test`. Rebuild the macOS CWS Proxy app after merge (`yarn workspace @cws/proxy app`).

**KEEP.** None of these tests close a protocol KEEP. They prove the proxy forwards the ACK the phone already sends.

### Phase 2 — Unknown apps whose command list was read

**Status.** Canton, Kaspa, IOTA, Nervos, Namada, and Spacemesh answer GET_VERSION only. Pubkey and SIGN stay `6D00`. Snapshot unknown is 31. Zcash is still unknown. IOTA block framing is still KEEP. Namada's version body includes the 4-byte target id because `docs/APDUSPEC.md` lists it. Spacemesh's table does not, so that body stops at the locked byte.

**Goal.** Handlers for Canton, IOTA, Kaspa, Namada, Nervos, Spacemesh. Zcash only after LedgerHQ/app-zcash is compared with Zondax/ledger-zcash. MATCH is `GET_VERSION` (and `GET_PUBLIC_KEY` only when the response body is copied from the spec and tested). SIGN stays KEEP.

**Mobile / protocol.** New family module, snapshot family, `family.test.ts`. Nervos: read the dispatcher for CLA before choosing a byte.

**Proxy.** Open App routing test if the new family changes what an empty probe selects. A version-only handler does not need a new multi-chunk test until SIGN exists.

**Tests.** `yarn workspace @cws/protocol-ledger test` and `yarn workspace @cws/contracts test`. Proxy tests when routing changes. Release USB install to the lab iPhone when the phone binary must match the tip.

### Phase 3 — Unknown apps with a repo and no extracted command list

**Status.** Qubic, Solar, LTO Network, and Factom answer the version command cited below. Pubkey and SIGN stay `6D00`. Snapshot unknown is 27. Factom's fourth version byte is major again, because that is what `handleGetAppConfiguration` writes. Elastos and Nimiq have INS tables and no version command, so they stay unknown. Babylon's commands are the bitcoin-client set and are not a bitcoin MATCH. Monero and Zcash stay out. Groestlcoin, Particl, Shimmer, IOTA Legacy, and XAH were not remapped.

**Goal.** Read `main.c` / `commands.h` / `COMMANDS.md` for Ark, Babylon, COTI, Decred, Elastos, Groestlcoin, IOTA Legacy, Monero, Nano, Nano's sibling Banano only if a real firmware appears, NEM, Particl, Radix Babylon, Shimmer, Core, Factom, LTO, MobileCoin (the linked ledger-mob page), Nimiq, Pepecoin, Qubic, Solar, XAH.

**Rule.** Groestlcoin, Particl, Banano, Shimmer, IOTA Legacy, and XAH are not remapped onto bitcoin, nano, IOTA, or XRP. Monero is its own PR. SIGN stays KEEP. If the file has no INS table, the row stays blocked and the plan is updated. Do not invent MATCH.

**Acceptance.** Same as phase 2.

### Phase 4 — High-host KEEP

**Status.** `SIGN_OPCERT`, `SIGN_CVOTE`, native script hash, CIP-8 Shelley messages, and Shelley and Byron `DERIVE_ADDRESS` are MATCH. A valid Byron address inside CIP-8 is `6982`. Solana `numPaths` other than 1 is `6A80`. Solana INS `20` is a 4-byte challenge. CIP-36 auxiliary registration, Solana INS `21`/`22`, the Bitcoin policy HMAC, and Ethereum clear-sign stay KEEP with the blockers in section 1b. The v8 and v7 2.2–7.2.1 canonical transaction hashes are FIXED. Snapshot unknown stays 27.

1. Cardano CIP-36 auxiliary registration stays KEEP. Operational certificate, CIP-36 vote, native script hash, CIP-8 Shelley messages, Shelley and Byron `DERIVE_ADDRESS`, and the v8 canonical transaction hash are MATCH or FIXED.
2. Solana `numPaths` other than 1 is `6A80`. INS `20` is MATCH. INS `21` / `22` stay KEEP (PKI TLV).
3. Bitcoin wallet-policy HMAC and merkle PSBT beyond the current tests stay KEEP. A zero HMAC stays labeled host-unproven. CLA `F8` INS `01` has an unarmed hold-forward test.
4. Ethereum clear-sign INS `22` / `32` / `36` / `38` / `3A` stay `6D00`. hw-app-eth sends `22` only, and that TLV is CAL-signed.

**Proxy.** Each multi-chunk command gets the phase 1 hold-forward test.

### Phase 5 — SIGN KEEP on newer families

One family, or a small set that shares a chunk mode, per PR. Official chunk mode, response length, and a confirm sheet. Algorand Ed25519 stays KEEP if the source is HDW_NORMAL and CWS would sign SLIP-10. XMSS (QRL), RSA (Arweave), Mina field, and Curve25519 (Waves) stay KEEP when the curve is not the one CWS derives. Proxy test in the same PR.

XRP ed25519, Polkadot SCALE, and TON cell hash stay KEEP. Stellar `maxDataSize` is MATCH (Nano X `4096`, other models `8192`). Tron ECDH and TIP-712 are MATCH. TIP-712 does not return firmware `6A8C` for a disabled sign-by-hash setting. Cosmos HRP GET_ADDR is MATCH. A length-prefixed Cosmos address body is still accepted.

XRP blocker: [app-xrp `sign_transaction.c`](https://github.com/LedgerHQ/app-xrp/blob/develop/src/apdu/messages/sign_transaction.c) returns a 64-byte EdDSA signature over `STX\0` ‖ tx. The private key is `bip32_derive_init_privkey_256(CX_CURVE_Ed25519)` in the Ledger SDK, not in the app tree. Polkadot blocker: SCALE and the metadata proof in the Zondax APDUSPEC are not parsed. TON blocker: the hash field is sha256 of the uploaded bytes, not the cell hash from a parsed BOC (`COMMANDS.md`). Newer-family SIGN stays KEEP on the curves named in section 1b. Those curves are not the ones CWS derives.

### Phase 6 — Trezor gaps Safe 7 hosts send

**Status.** KEEP. No Suite trace was recorded for the messages below, so none of those protobufs were decoded. A Proxy USB HID test now sends `EthereumGetAddress` (56), which the handler already answers, and checks `EthereumAddress` after `ButtonAck`. That test is not a MATCH for 906, 471, or 472. `trezord` forwards the same already-implemented call. WebHID allowlist and trezord Origin reflection were not tightened.

QR pairing (1032/1033) and NFC pairing (1040/1041) stay KEEP until a Safe 7 host selects `ThpPairingMethod` QrCode or NFC. Stellar op-by-op and Monero stay KEEP until a trace exists.

Capture checklist (record the Suite screen, then the USB or THP bytes; do not mark MATCH from the name alone):

| Id | What to record |
| --- | --- |
| 906–908 | Suite Solana app, Sign message. Capture `SolanaSignMessage` through `SolanaMessageSignature`. |
| 471 / 472 | Suite Ethereum, a typed-data or definition request that asks the host for `EthereumDefinitions` / `EthereumDefinitionAck` before the signature. |
| Cardano extra stages | Suite Cardano, a transaction that is not the stages already tested (witness path, auxiliary supplement 314, host ack 317, finished 319). Record each `CardanoTx*` id in order. |

### Phase 7 — OneKey gaps the OneKey app sends

**Status.** KEEP. The ids are present in OneKey firmware. No OneKey desktop or mobile capture was taken, and CWS does not decode those protobufs. A Proxy test now sends a sign-sized V2 ping that spans 64-byte HID reports (`usbHid.ts` `wrapPrefixedHid`, 63 payload bytes per report) and checks the echoed `Success`. That is a transport test, not a MATCH for 20106 or 20107.

Ethereum tx ack 20106/20107, EIP-7702 20120, Solana unsafe message 10106, Sui tx request/ack, and TON proof and sign-data stay KEEP until a capture shows the bytes. Algorand, Filecoin, Kaspa, and the long tail stay KEEP for the same reason.

Capture checklist (record the OneKey App screen, then the V1 or V2 bytes):

| Id | What to record |
| --- | --- |
| 20106 / 20107 | OneKey Ethereum, sign a transaction that returns `EthereumTxRequestOneKey` and waits for `EthereumTxAckOneKey`. |
| 20120 | OneKey Ethereum, an EIP-7702 authorization or set-code transaction. |
| 10106 | OneKey Solana, sign an off-chain or unsafe message (`SolanaSignUnsafeMessage` or the id the app actually writes). |
| Sui tx ack | OneKey Sui, sign a transaction. Record the request id and the ack id if the app chunks the transaction. |
| TON proof | OneKey TON, a proof or sign-data screen, not a simple get-address. |

### Phase 8 — QR registry types hosts scan

**Status.** KEEP for every registry type this tree does not already encode. No new type was added. Rabby, MetaMask, OKX, Sparrow, and the Keystone app were not shown scanning an unimplemented type in this pass. The types CWS already encodes stay MATCH in [vendor-protocols.md](vendor-protocols.md). Fountain tests cover multipart. Seed QR still confirms. No proxy UR bridge.

Static single-account UR PNG (`apps/mobile/src/qr/qrPng.ts`, `qrPng.test.ts`): ECC level M, four-module quiet zone, default 8 px modules, pixels only `0x00` and `0xFF`. There is no brightness control because the bitmap is already full contrast. On 2026-10-31, host `ki-mac-mini` encoded that PNG for the OneKey and Keystone account profiles. Local `zbarimg` 0.23.95 decoded both files. Rabby was not opened (Chrome’s extension directory is blocked by macOS). OneKey.app 6.6.3 was not given a scan session. No Keystone wallet app is installed. Continuity Camera is enumerated as the lab iPhone, and ffmpeg timed out without a frame while Preview showed the PNG. That attempt is host-only KEEP in [testing.md](testing.md). It is not a host PASS.

## Honest KEEP after #68

Checked on tip `dfb1f6d`. Nothing below is MATCH. Seeds are not absolutely safe.

| Item | Blocker |
| --- | --- |
| Cardano CIP-36 auxiliary (v8 P1 `13`, v7 P2 `34`) | `aux_data_hash_builder` is not built. Reply stays `6D00`. An arbitrary aux hash already in the v8 init is body field 7 |
| Cardano pool registration, voting procedures, and app versions before 2.2 | Fail closed with `6A80`. v7 2.2 through 7.2.1 and v8 payment, swap, datum, token, collateral, and reference-input body hashes are FIXED |
| Solana INS `21` / `22` | `tlv_use_case_trusted_name` plus a Ledger PKI signature. INS `20` and `numPaths == 1` are MATCH |
| Bitcoin wallet-policy HMAC | `walletHmac` uses `CWS/ledger-wallet-hmac`, not the app-bitcoin policy key. A zero HMAC stays host-unproven (`Policy HMAC is all zeros and was not checked.`) |
| Bitcoin merkle PSBT beyond current tests | Cases in `family.test.ts` and `handler.test.ts` are the limit. CLA `F8` INS `01` has an unarmed hold-forward test. That test is not a policy-key MATCH |
| Ethereum INS `22` / `32` / `36` / `38` / `3A` | hw-app-eth sends only `22`. The TLV is CAL-signed. All five stay `6D00` |
| Tron sign-by-hash word `6A8C` | ECDH and TIP-712 are MATCH. CWS has no off switch, so `E_MISSING_SETTING_SIGN_BY_HASH` is not returned |
| XRP ed25519 P2 `80` | `sign_transaction.c` signs SHA-512 of `STX\0` ‖ tx (64 bytes). The key is SDK `bip32_derive_init_privkey_256`. CWS will not guess SLIP-10 |
| Polkadot SCALE / metadata | The Zondax metadata proof is not parsed |
| TON cell hash | The hash field is sha256 of the uploaded bytes, not a parsed BOC cell hash |
| Newer-family SIGN | The firmware curve is not the one CWS derives. See the section 1b list (HDW_NORMAL, XMSS, RSA, Mina field, Curve25519, and the rest) |
| Trezor `1032`/`1033`, `1040`/`1041`, `906`, `471`/`472`, extra Cardano stages | No Suite trace selects them. Protobuf layouts are not decoded |
| OneKey `20106`/`20107`, `20120`, `10106`, Sui tx, TON proof | Ids exist in firmware. No desktop or mobile capture of the bytes |
| QR types not already encoded | No Rabby, MetaMask, OKX, Sparrow, or Keystone scan of an unimplemented registry type |

---

## Acceptance (every implementation PR)

**Phone and protocol package.** Bytes match the cited source: CLA, INS, P1, P2, chunk ACK body, final body length, and when the sheet opens. A test in `family.test.ts`, `apduWire.test.ts`, or the vendor handler test. A KEEP that is not closed stays KEEP in `ledger-apdu.md` or `vendor-protocols.md`.

**Proxy.** If a WebHID or trezord host can send it, `adapters.test.ts` covers the multi-chunk or unarmed-status path. Rebuild the macOS proxy app after a proxy change.

**Honesty.** Family remap is not MATCH. `GET_VERSION` MATCH is not SIGN MATCH. No MATCH without a citation and a test.

**Report.**

```
URL:
Tip SHA after squash-merge:
Unknown catalog before → after:
KEEP closed:
KEEP left:
Proxy tests added:
Mobile USB install: yes/no
CWS Proxy macOS rebuild: yes/no
Residual risks:
Seeds are not absolutely safe.
```

## Out of scope

- Ledger Live genuine check.
- Ethereum plugin IPC.
- Manager utilities as coin signers.
- A WebHID allowlist, a trezord origin lockdown, or a confirm on every extended public key. Those break hosts this tree already speaks. [security.md](security.md) records them.
- Virtual HID on Windows.
- A MATCH for a 404 repository.
- Any wording that says a seed is absolutely safe.
