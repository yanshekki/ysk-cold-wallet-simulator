# CWS Proxy macOS screenshots

App Store Connect, Mac, **繁體中文**. Version **1.1.0**. Bundle `hk.ysk.cws.proxy`.

Use the `2880×1800` files in the screenshot slot. `1280×800` is the same frame, scaled, for the smallest accepted size.

Each pair is the real Proxy page (`apps/proxy/ui`), which is what the Mac app shows. The window is that page, with a short 香港書面語 line and an English line. Phone App Store frames are not in this repo, so the type and colours follow the shared CWS UI: `#07080A`, IBM Plex, lime `#C8F542`, orange `#FF5A1F`.

No seed, mnemonic, or private key. The signing sheet uses the lab’s own sample (`hello from lab`) and the public path `m/44'/60'/0'/0/0`. The console hex is a short version exchange (`cla=e0 ins=01`), not key material.

| Stem | What it shows |
| --- | --- |
| `01-home` | 繁中. Ledger Nano X connected. Virtual HID up. Clock running. |
| `02-waiting` | 繁中. Proxy is scanning. No phone yet. |
| `03-pairing` | 繁中. Trezor Safe 7, GATT connecting. Pairing field empty. |
| `04-webhid` | English. Trezor Safe 7, HID up, trezord `http://127.0.0.1:21325`. |
| `05-language` | The same connected Nano X screen in 繁體中文（香港） and English. |
| `06-apdu` | 繁中 console. Scan, GATT, HID, and one APDU. No secret. |
| `07-signing` | 繁中 testnet host. personal_sign sheet open. Not submitted. |

Filenames are `{stem}-2880x1800.png` and `{stem}-1280x800.png`.
