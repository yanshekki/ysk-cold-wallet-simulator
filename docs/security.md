# Security

**Version 1.1.4 (build 10).** [YSK Limited](https://ysk.hk) · [ysk.hk/products/ysk-cold-wallet-simulator](https://ysk.hk/products/ysk-cold-wallet-simulator)

This is the public statement of what CWS protects and what it leaves open. Seeds are not hardware-wallet safe.

**Seeds are not absolutely safe.** CWS has no secure element. Do not put a seed that controls real digital assets on the device.

Read this before you generate or import a secret. The short version is on the [README](../README.md). The same statement in 繁體中文（香港） is below. The product page is [zh-HK.md](zh-HK.md).

## Hot-wallet baseline

This is progress toward Phantom, Rabby, and MetaMask mobile. It is not a secure element. Seeds are not hardware-wallet safe.

| Item | Result | Residual |
| --- | --- | --- |
| Keychain `requireAuthentication` on entropy and shares in a release build | Pass | The skip exists only when `__DEV__` is true. Release always sets the flag. The first successful read is cached in memory until lock. Reveal and backup force a fresh authenticator read. An item saved before this flag is rewritten on the next read |
| No mnemonic or private key on the clipboard. System copy is off. Seed QR and backup wait for a confirm sheet | Pass | Import does not read the clipboard until Paste is confirmed. A successful import clears the clipboard when it still holds that pasted text. CWS does not write a phrase. The phrase and share screens do not offer a copy button. Console export is log text, not a seed |
| Android `FLAG_SECURE` on secret screens in release. iOS app-switcher blur and a capture warning | Pass. The iOS warn-only choice is intentional | `preventScreenCapture` blacks the live window whenever iOS reports a capture, including mirroring and Control Center. CWS does not do that. It warns and blurs the app switcher. Another camera can photograph the screen. Debug Android skips `FLAG_SECURE` only while `__DEV__` is true |
| Release manifest blocks `SYSTEM_ALERT_WINDOW` | Pass | Debug still allows cleartext traffic for Metro. Release does not merge that manifest |
| Public account and xpub reads confirm on the phone | Pass for the phone policy | Firmware P1=0 stays silent in protocol tests. The phone sets `confirmSilentPublic`. One confirm covers that read plus the next 15 public reads for 60 seconds. It does not cover a signature. Disconnect and lock clear the batch. This is not a Ledger wire MATCH |
| BLE link key where the OS exposes it. Session cleared on disconnect | Pass, with a gap | iOS CoreBluetooth does not expose the bond, so those hosts use the phone confirm. Disconnect resets the link, the allowed central, and the pairing code. It does not wipe the vault |
| VoiceOver and TalkBack do not speak the recovery words | Pass | The grid label is `Recovery word N`. The letters stay on screen for the person looking at it |
| Proxy does not store a seed and redacts mnemonic-like lines and long hex in its log | Pass | The proxy still forwards every APDU the phone accepts. It is transport only |

## What the software does

- A new BIP39 or SLIP-39 secret comes from the operating-system CSPRNG. The mnemonic and the SLIP-39 shares are shown so they can be written down. They are not written to the clipboard. The screens that show a phrase or a share do not offer a copy button. The system copy menu is disabled on fields that hold a phrase, a share, entropy, a verify word, or a passphrase. Import reads the clipboard only after the Paste confirm. A successful import then clears the clipboard when it still holds that text.
- The stored value is entropy, or the SLIP-39 secret, in `expo-secure-store`, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. A release build also sets `requireAuthentication`. The web build refuses to store it. A passphrase stays in memory for the session and is wiped on lock. `lockVaultMemory` drops the cached secret.
- A release build asks the OS authenticator before a secret is revealed, imported, saved, or applied as a passphrase, and again before a signature or a backup-seed QR is produced. Debug builds skip the reveal prompt so a lab session can run. Sign and seed export on a debug build follow the Settings toggle. A release build asks even when that toggle is off.
- Vault, import, generate, the passphrase sheet, a backup-seed QR, and the seed-export confirmation are secret screens. Android release sets `FLAG_SECURE` on those screens. The debug skip is `__DEV__` only. iOS blurs the app switcher and shows a warning when the OS reports a capture. Leaving the live image visible is intentional: blanking it also blanks mirroring and Control Center.
- Recovery words are visible and are not an accessibility label. The spoken name is the word index. Masked passphrase fields expose the field name, not the secret.

## What stays open, on purpose

Closing the items below would stop real wallets from connecting. They are residual risk. 1.1.4 does not claim to have removed them.

### WebHID

The proxy forwards HID reports to the phone as APDUs. There is no command allowlist. A site you connect in Chrome can send any command the phone already implements, including a silent address or extended-public-key read. A signature and a seed export still wait for the phone.

### trezord

The local bridge listens on `127.0.0.1` and reflects the request `Origin` (or `*` when Origin is absent). Trezor-compatible wallets need that behaviour. Any browser origin on the same machine can talk to the bridge while it is running. Signatures still confirm on the phone.

### Public export on the phone

The phone confirms public account and xpub reads, including firmware P1=0. One confirm covers that read and the next 15 public reads for 60 seconds. A signature is not included. Disconnect and lock end the batch. Protocol tests without `confirmSilentPublic` still follow the silent firmware path. That flag is a hot-wallet policy. It is not a claim that the Ledger app confirms those reads. A chain code in the reply is still not the seed.

### Keychain

Release writes set `requireAuthentication`. The decision is `keychainRequiresAuthentication(isDevBuild())`, and `isDevBuild()` is only Metro's `__DEV__`. After one successful read the value stays in process memory until lock, so a host session does not prompt the authenticator on every address. Reveal and backup pass `forceAuth` and read the keychain again. iPhone Mirroring can still fail a prompt that the OS raises. The in-memory copy is not a secure element.

## Platform limits

- **iOS screenshots and mirroring.** Warn-only is intentional. `preventScreenCapture` paints the live window black whenever iOS reports a capture, including mirroring and Control Center. CWS blurs the app switcher and shows a warning instead. Another camera can photograph the screen. There is no polling loop. Android release still sets `FLAG_SECURE`. That skip is `__DEV__` only.
- **iOS BLE link key.** The operating system does not expose it. A signature still requires confirmation of the host when the link key is absent. Disconnect clears the link, the allowed central, and the pairing code. The link is not bound to an OS pairing key on iOS.
- **Proxy.** The desktop app does not write a seed to disk. Its status log redacts a 12-or-more-word line and hex runs of 64 characters or more. It still forwards host APDUs to the phone.
- **Debug builds.** `SYSTEM_ALERT_WINDOW` is absent from the debug manifest and from the release manifest. Debug still allows cleartext traffic so Metro can load the bundle. Release does not merge the debug manifest. The screenshot listener declares `DETECT_SCREEN_CAPTURE`. That is not an overlay permission.
- **Release signing.** A Play upload build is signed from the publisher’s environment. This repository contains no keystore and no upload password. If that configuration is absent, release packaging fails instead of signing with the debug key. A debug phone does not prove the release authenticator prompt.

## Known host gaps

These gaps remain open in 1.1.4. They were already open in 1.1.0. They are usability gaps. They are not a reason to drop the public-read confirm.

- Phantom may not complete unlock after connect.
- Rabby’s camera may still fail to scan the phone QR. The static account PNG is ECC M, a four-module quiet zone, 8 px modules, and black-on-white (`qrPng.ts`). On 2026-10-31, host `ki-mac-mini` encoded that PNG for the OneKey and Keystone account profiles. Local `zbarimg` 0.23.95 decoded both files. That is not a wallet scan. Rabby was not opened: Chrome’s extension directory returned `Operation not permitted`, and an unpacked Rabby 0.94.13 tree was not loaded. OneKey.app 6.6.3 was not given a scan session. No Keystone wallet app is installed. Continuity Camera is enumerated as the lab iPhone, and ffmpeg timed out without a frame while Preview showed the PNG. The attempt is host-only KEEP in [testing.md](testing.md). Unimplemented Keystone UR types stay out of the export.
- Avalanche Core may not list Avalanche X and P accounts end to end.
- OKX may not show asset balances for an imported account.

Address export and the signing sheet are covered by the automated suites in [testing.md](testing.md). Ledger Live’s genuine-device check is not expected to pass. CWS does not present itself as Ledger Live, Trezor Suite, or the OneKey app.

## What a reader should assume

Anyone who can unlock the phone, debug the process, photograph the screen, or connect a host can reach more than the UI shows. Treat every secret entered here as compromised for any purpose that matters.

## 繁體中文（香港）

**版本 1.1.4（組建編號 10）。** [YSK Limited](https://ysk.hk) · [ysk.hk/products/ysk-cold-wallet-simulator](https://ysk.hk/products/ysk-cold-wallet-simulator)

這是 CWS 保護甚麼、留下甚麼的公開說明。種子不是硬體錢包級安全。

**種子並非絕對安全。** CWS 沒有安全元件。請勿把掌管真實數碼資產的種子放進這部裝置。

產生或匯入秘密資料之前請先閱讀本頁。簡述在 [產品頁](zh-HK.md)。英文說明在上文。

### 熱錢包基線

這是朝向 Phantom、Rabby 及 MetaMask 手機版的進度。它不是安全元件。種子不是硬體錢包級安全。

| 項目 | 結果 | 殘餘 |
| --- | --- | --- |
| 正式組建對熵與份額設定鑰匙圈 `requireAuthentication` | 通過 | 略過只在 `__DEV__` 為真時存在。正式組建必定設定該旗標。第一次成功讀取會留在記憶體，直到鎖定。顯示與備份會強制再讀一次認證。此旗標出現之前已儲存的項目，會在下一次讀取時重寫 |
| 剪貼簿沒有助記詞或私鑰。系統複製已關閉。種子二維碼與備份須等確認表 | 通過 | 匯入在確認貼上之前不會讀剪貼簿。匯入成功後，若剪貼簿仍是剛貼上的文字，會把它清掉。CWS 不會寫入助記詞。助記詞與份額畫面沒有複製按鈕。主控台匯出的是紀錄文字，不是種子 |
| Android 正式組建在秘密畫面設定 `FLAG_SECURE`。iOS 模糊應用程式切換器，並在擷取時警告 | 通過。iOS 只警告是有意的 | `preventScreenCapture` 會在 iOS 報告擷取時把即時視窗塗黑，包括鏡像與控制中心。CWS 不這樣做。它只警告，並模糊應用程式切換器。另一部相機仍可拍下螢幕。Android 除錯組建只在 `__DEV__` 為真時略過 `FLAG_SECURE` |
| 正式清單阻擋 `SYSTEM_ALERT_WINDOW` | 通過 | 除錯組建仍允許明文流量，以便 Metro。正式組建不會合併該清單 |
| 手機確認公開帳戶與擴展公鑰讀取 | 就手機政策而言通過 | 韌體 P1=0 在協議測試中仍保持靜默。手機設定 `confirmSilentPublic`。一次確認涵蓋該次讀取，以及其後 60 秒內的 15 次公開讀取。它不包括簽署。斷線與鎖定會清掉這一批。這不是 Ledger 傳輸位元組上的 MATCH |
| 作業系統有提供時使用 BLE 連結金鑰。斷線時清除工作階段 | 通過，並有一項缺口 | iOS CoreBluetooth 不提供綁定，因此那些主機改用手機確認。斷線會重設連結、允許的中心裝置及配對碼。它不會清掉種子庫 |
| VoiceOver 與 TalkBack 不讀出復原詞 | 通過 | 格子的標籤是 `Recovery word N`。字母仍留在畫面上，給看着螢幕的人 |
| 代理程式不儲存種子，並在紀錄中遮去像助記詞的行與長十六進制 | 通過 | 代理程式仍會轉送手機接受的每一條 APDU。它只是傳輸 |

### 軟件實際做的事

- 新的 BIP39 或 SLIP-39 秘密資料來自作業系統的密碼學安全隨機數。助記詞與 SLIP-39 份額會顯示出來，以便抄寫。它們不會寫入剪貼簿。顯示助記詞或份額的畫面沒有複製按鈕。持有助記詞、份額、熵、核對詞或密語的欄位已關閉系統複製選單。匯入只在確認貼上之後才讀剪貼簿。匯入成功後，若剪貼簿仍是該段文字，會把它清掉。
- 儲存的是熵，或 SLIP-39 秘密，放在 `expo-secure-store`，使用 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`。正式組建另設定 `requireAuthentication`。網頁組建拒絕寫入。密語只存在於該工作階段的記憶體，鎖定時清除。`lockVaultMemory` 會丟掉快取的秘密。
- 正式組建在顯示、匯入、儲存或套用密語之前，以及在產生簽署或備份種子二維碼之前，會要求作業系統認證。除錯組建略過顯示時的提示，以便實驗室操作。除錯組建的簽署與種子匯出依設定開關。正式組建即使關閉該開關仍會詢問。
- 種子庫、匯入、產生、密語表、備份種子二維碼及種子匯出確認均為秘密畫面。Android 正式組建在這些畫面設定 `FLAG_SECURE`。除錯略過只在 `__DEV__`。iOS 會模糊應用程式切換器，並在系統報告擷取時顯示警告。保留即時畫面是有意的：塗黑它亦會塗黑鏡像與控制中心。
- 復原詞是可見的，並不是無障礙標籤。讀出的名稱是詞語序號。已遮罩的密語欄位只暴露欄位名稱，不暴露秘密。

### 為相容而保留的風險

關閉下列項目會令真實錢包無法連線。它們是殘餘風險。1.1.4 並不宣稱已消除它們。

**WebHID。** 代理程式把 HID 報告轉成 APDU 送到手機。沒有指令允許清單。你在 Chrome 連接的網站可以發送手機已實現的任何指令，包括韌體上屬靜默的地址或擴展公鑰讀取。簽署與種子匯出仍須等手機。

**trezord。** 本機橋接器聽 `127.0.0.1`，並反映請求的 `Origin`（沒有 Origin 時為 `*`）。Trezor 相容錢包需要此行為。橋接器運行時，同一部電腦上的任何瀏覽器來源都可以跟它通訊。簽署仍須在手機確認。

**手機上的公開匯出。** 手機確認公開帳戶與擴展公鑰讀取，包括韌體 P1=0。一次確認涵蓋該次讀取，以及其後 60 秒內的 15 次公開讀取。不包括簽署。斷線與鎖定會結束這一批。沒有 `confirmSilentPublic` 的協議測試仍走靜默韌體路徑。該旗標是熱錢包政策。它不是「Ledger 應用程式會確認這些讀取」的宣稱。回覆裡的鏈碼仍然不是種子。

**鑰匙圈。** 正式寫入設定 `requireAuthentication`。決定函數是 `keychainRequiresAuthentication(isDevBuild())`，而 `isDevBuild()` 只看 Metro 的 `__DEV__`。一次成功讀取之後，數值留在行程記憶體直到鎖定，因此主機會話不會在每個地址都提示認證。顯示與備份傳入 `forceAuth`，再讀一次鑰匙圈。iPhone 鏡像仍可能令作業系統提出的提示失敗。記憶體內的複本不是安全元件。

### 平台限制

- **iOS 截圖與鏡像。** 只警告是有意的。`preventScreenCapture` 會在 iOS 報告擷取時把即時視窗塗黑，包括鏡像與控制中心。CWS 改為模糊應用程式切換器並顯示警告。另一部相機仍可拍下螢幕。沒有輪詢迴圈。Android 正式組建仍設定 `FLAG_SECURE`。該略過只在 `__DEV__`。
- **iOS BLE 連結金鑰。** 作業系統不提供它。沒有連結金鑰時，簽署仍須確認主機。斷線會清掉連結、允許的中心裝置及配對碼。iOS 上的連結並不綁定作業系統的配對金鑰。
- **代理程式。** 桌面應用程式不會把種子寫入磁碟。狀態紀錄會遮去 12 個詞或以上的一行，以及 64 個字元或以上的十六進制。它仍會把主機的 APDU 轉送到手機。
- **除錯組建。** `SYSTEM_ALERT_WINDOW` 不在除錯清單，亦不在正式清單。除錯組建仍允許明文流量，以便 Metro 載入套件。正式組建不會合併除錯清單。截圖監聽聲明 `DETECT_SCREEN_CAPTURE`。這不是浮動視窗權限。
- **正式簽署。** Play 上架組建由發行者的環境簽署。本版本庫沒有金鑰庫，亦沒有上載密碼。該設定缺席時，正式包裝會失敗，而不會改用除錯金鑰。除錯手機不能證明正式組建的認證提示。

### 已知的主機缺口

這些缺口在 1.1.4 仍然開放。它們在 1.1.0 已經開放。它們是可用性缺口，不是取消公開讀取確認的理由。

- Phantom 連線後可能無法完成解鎖。
- Rabby 的相機仍可能掃不到手機二維碼。靜態帳戶 PNG 是 ECC M、四模組安靜區、8 像素模組、黑白（`qrPng.ts`）。2026-10-31，主機 `ki-mac-mini` 為 OneKey 與 Keystone 帳戶設定編碼了該 PNG。本機 `zbarimg` 0.23.95 解出了兩個檔案。那不是錢包掃描。Rabby 沒有開啟：Chrome 的擴充功能目錄回傳 `Operation not permitted`，未載入解包的 Rabby 0.94.13。OneKey.app 6.6.3 沒有得到掃描工作階段。沒有安裝 Keystone 錢包應用程式。Continuity Camera 列為實驗室的 iPhone，Preview 顯示了 PNG，ffmpeg 卻逾時而沒有影格。該次嘗試在 [testing.md](testing.md) 是只限主機的 KEEP。未實現的 Keystone UR 類型不在匯出之內。
- Avalanche Core 可能無法完整列出 Avalanche X 與 P 帳戶。
- OKX 可能無法顯示已匯入帳戶的資產餘額。

地址匯出與簽署表由 [testing.md](testing.md) 的自動測試涵蓋。不應期望 Ledger Live 的正品檢查通過。CWS 不會把自己表述為 Ledger Live、Trezor Suite 或 OneKey 應用程式。

### 讀者應假設

能夠解鎖手機、除錯行程、拍攝螢幕或連上主機的人，所能取得的資料多於介面所顯示。任何在此輸入的秘密資料，均應視為已不適合用於重要用途。
