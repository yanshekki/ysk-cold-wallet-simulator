# CWS Proxy macOS screenshots

Store index: [../README.md](../README.md).

Version **1.1.0 (build 6)**. Bundle `hk.ysk.cws.proxy`. Two complete Mac sets, in `zh-HK/` and `en/` only. Upload one folder per App Store Connect localization. Do not mix the two locales.

Primary size is `2880×1800`. `1280×800` is the same frame, scaled.

## zh-HK

Proxy UI language is 繁體中文（香港）. The caption on each frame is 香港書面語 only.

## en

Proxy UI language is English. The caption on each frame is English only.

## Stems

| Stem | Scene |
| --- | --- |
| `01-home` | Phone connected. Ledger Nano X. Virtual HID up. |
| `02-waiting` | Scanning. No phone yet. |
| `03-pairing` | Trezor Safe 7. Pairing field empty. |
| `04-webhid` | HID up. trezord `http://127.0.0.1:21325`. |
| `05-language` | Language control set to that folder’s locale. |
| `06-apdu` | Console. One version exchange. No seed. |
| `07-signing` | Testnet host. personal_sign sheet open, not submitted. |

Filenames are `{stem}-2880x1800.png` and `{stem}-1280x800.png` inside `zh-HK/` and `en/`.

The zh-HK build of the app still shows its own technical tokens (model names, `Service UUID`, `VID / PID`, and console trace lines). Those are the product UI. The caption beside the window is Chinese only.

No seed, mnemonic, or private key. The zh-HK signing sample is 測試訊息. The English sample is the lab default `hello from lab`. The path is the public `m/44'/60'/0'/0/0`.
