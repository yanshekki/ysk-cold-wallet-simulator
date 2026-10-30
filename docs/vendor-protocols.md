# Trezor, OneKey, and QR wire notes

Research date: 30 Oct 2026. Ledger APDU stages are in [ledger-apdu.md](ledger-apdu.md). The phased backlog for Trezor, OneKey, QR, Proxy, and the remaining Ledger work is [full-vendor-parity-plan.md](full-vendor-parity-plan.md). This note is the diff for the other protocols this tree actually speaks. Seeds are not absolutely safe.

## Trezor THP

Message numbers were compared with [trezor-firmware `MessageType.py`](https://github.com/trezor/trezor-firmware/blob/main/core/src/trezor/enums/MessageType.py) and [messages-thp.proto](https://github.com/trezor/trezor-firmware/blob/main/common/protob/messages-thp.proto) `ThpMessageType`.

Every Trezor id in `packages/protocol-trezor/src/messages.ts` matched those files except one:

| Name | CWS had | Upstream | Direction |
| --- | --- | --- | --- |
| `CardanoTxAuxiliaryDataSupplement` | (called this HostAck) | 314 | device → host |
| `CardanoTxHostAck` | 314 | 317 | host → device |
| `CardanoTxBodyHash` | absent | 318 | device → host |

Suite sends **317** after the witness. 314 is the auxiliary-data supplement the device would send. Treating 314 as the finish ack completes the sign on the wrong message and ignores the real ack. The constant is now 317. A test sends 314 and expects `Failure`, then 317 and expects `CardanoSignTxFinished` (319).

THP pairing and code-entry ids 1008–1010 and 1018–1028 match `ThpMessageType`. `ThpCreateNewSession` is 1000. KEEP: QR-code pairing (1032/1033) and NFC pairing (1040/1041) are not implemented.

Binance message ids 700/701/704/709 are not in current `MessageType.py`. KEEP: they stay for older firmware and are not claimed against today's enum.

Protobuf field layouts beyond these ids were not re-decoded in this pass. A matching id with a wrong field still fails the host. That remains a KEEP until a host trace shows it.

## OneKey

The same Cardano ids were checked against [OneKeyHQ/firmware-pro `MessageType.py`](https://github.com/OneKeyHQ/firmware-pro/blob/main/core/src/trezor/enums/MessageType.py). `CardanoTxHostAck` is 317 there too. The other 113 ids in `packages/protocol-onekey/src/messages.ts` matched that file, including the OneKey ranges (`SolanaGetAddress` 10100, `TronGetAddress` 10501, `SignPsbt` 10052, `OnekeyGetFeatures` 10025). OneKey is not given Trezor's Solana id 904.

V1 framing (`3F2323`) and V2 chunked frames are what the OneKey handler already switches on. This pass did not find a second id mismatch.

A Proxy test sends a V2 ping larger than one HID report and checks that `Success` still echoes the message. It does not decode 20106, 20107, 20120, or 10106.

## Capture checklist (not MATCH)

No Suite or OneKey App trace was saved for this list. Record the screen, then the bytes. Do not treat the id as implemented.

| Host | Id | Screen to record |
| --- | --- | --- |
| Trezor Suite | 906–908 | Solana, Sign message |
| Trezor Suite | 471 / 472 | Ethereum typed data that requests definitions before the signature |
| Trezor Suite | Cardano stages beyond 314 / 317 / 319 | A Cardano transaction whose `CardanoTx*` sequence is not the one already tested |
| OneKey App | 20106 / 20107 | Ethereum sign that acks `EthereumTxRequestOneKey` |
| OneKey App | 20120 | Ethereum EIP-7702 authorization |
| OneKey App | 10106 | Solana unsafe or off-chain message |
| OneKey App | Sui tx ack | Sui transaction sign, including any ack id |
| OneKey App | TON proof | TON proof or sign-data, not get-address |

## QR (BC-UR / Keystone)

Type strings this tree encodes, checked against [KeystoneHQ/ur-registry `RegistryType.ts`](https://github.com/KeystoneHQ/ur-registry/blob/master/src/RegistryType.ts) and the tests in `packages/protocol-qr`:

| UR type | Registry | CWS | Status |
| --- | --- | --- | --- |
| `crypto-hdkey` | tag 303 | account export | MATCH, `hdkey.test.ts` |
| `crypto-account` | tag 311 | single account | MATCH |
| `crypto-multi-accounts` | tag 1103 | multi-account | MATCH |
| `crypto-output` | tag 308 | output descriptor | MATCH, encoder exists |
| `crypto-psbt` | tag 310 | PSBT sign | MATCH, `psbt.test.ts` |
| `eth-sign-request` / `eth-signature` | Keystone ETH registry, not the core file above | animated sign | MATCH, `ethSign.test.ts` |
| `sol-sign-request` / `sol-signature` | Keystone SOL registry | animated sign | MATCH, `chainSign.test.ts` |
| `cosmos-sign-request` / `cosmos-signature` | Keystone Cosmos registry | animated sign | MATCH, `chainSign.test.ts` |

Fountain encoding uses `@ngraveio/bc-ur`. BBQR is a separate Coldcard multipart format and has its own encoder.

KEEP, present in the Keystone core registry and not implemented here: `uuid`, `bytes`, `crypto-keypath`, `crypto-coin-info`, `crypto-eckey`, `crypto-psbt-extend`, `qr-hardware-call`, `key-derivation-call`, `key-derivation-schema`, `derive-context-hash-call`. No encoder was added for those. `crypto-seed` in the profile list is a CWS export name, not a core registry type in that file.
