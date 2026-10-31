# YSK Cold Wallet Simulator

**版本 1.1.4（組建編號 10）** · [YSK Limited](https://ysk.hk) · [產品頁](https://ysk.hk/products/ysk-cold-wallet-simulator)

手機套件識別碼 `hk.ysk.cws` · CWS Proxy 套件識別碼 `hk.ysk.cws.proxy`

版本庫：[github.com/yanshekki/ysk-cold-wallet-simulator](https://github.com/yanshekki/ysk-cold-wallet-simulator/)

本軟件給需要測試錢包互通的開發者及錢包團隊使用。手機以藍牙周邊裝置的形式，模擬指定的硬體錢包，並以供應商協議與第三方錢包通訊。

手機把 BIP39 或 SLIP-39 秘密資料存放於作業系統的安全儲存。桌面代理程式可把該手機呈現為 USB HID 裝置。帳戶資料亦可以動畫或靜態二維碼離開手機。

手機應用程式與代理程式介面提供 English、繁體中文（香港）、Español、العربية、Português、Bahasa Indonesia、Français、日本語、Русский 及 Deutsch。

English: [../README.md](../README.md)

## 警告

CWS 是模擬器。它不是安全元件。Ledger、Trezor 及 OneKey 均未認可本軟件。請勿以本軟件保管真實數碼資產。

**種子並非絕對安全。** 產生或匯入秘密資料之前，請先閱讀 [security.md](security.md)。

## 下載

版本 1.1.4（組建編號 10），保留 1.1.3 的基線，移除複製助記詞與複製份額按鈕，並顯示代理程式用來鎖定電話的藍牙裝置識別。那些複製控制不會把還原資料寫入剪貼簿。種子並非絕對安全。

[GitHub Release v1.1.0](https://github.com/yanshekki/ysk-cold-wallet-simulator/releases/tag/v1.1.0) 是唯一的標籤。該頁只有說明，沒有附上 APK、IPA 或桌面安裝包。其後的說明同樣沒有附上二進位檔。見 [releases/README.md](releases/README.md)。

| 產品 | 取得方式 |
| --- | --- |
| Android 手機 | [Google Play](https://play.google.com/store/apps/details?id=hk.ysk.cws)（`hk.ysk.cws`） |
| iOS 手機 | App Store：即將推出 |
| CWS Proxy（macOS） | Mac App Store：即將推出。HID Virtual Device 的 App Store entitlement 仍是 **Submitted**，尚未獲批。從原始碼組建：[proxy-macos.md](proxy-macos.md)。 |
| CWS Proxy（Ubuntu） | 套件 `hk.ysk.cws.proxy`（amd64 與 arm64）。在 Ubuntu 執行 `bash apps/proxy/linux/build-deb.sh`，再安裝該 `.deb`。套件會安裝 `cws-proxy` 及 `uhid` 的 udev 規則。GitHub Release 沒有附上這個 `.deb`。見 [Ubuntu 安裝包](#ubuntu-安裝包)。 |
| CWS Proxy（其他 Linux） | 沒有安裝包。請從原始碼執行 `yarn proxy`，並先套用快速開始所述的 `uhid` 規則。 |
| CWS Proxy（Windows） | 沒有已封裝的下載。請從原始碼先組建 `@cws/native-proxy`，再執行 `yarn proxy`。Windows 沒有虛擬 HID，因此不會建立 USB HID 裝置。本機頁面是 `http://127.0.0.1:8788`。 |

虛擬 HID 在 Linux（`/dev/uhid`，包括 Ubuntu 安裝包）及 macOS 的 CWS Proxy 應用程式實現。Windows 沒有虛擬 HID。

產品版本 **1.1.4** 與組建編號 **10** 來自 `apps/mobile/app.json` 的 `version`、`versionCode` 及 `buildNumber`。Expo prebuild 會寫入 Android 的 `versionName`／`versionCode`，以及 iOS 的 `CFBundleShortVersionString`／`CFBundleVersion`。隨應用程式發行的工作區套件版本同為 `1.1.4`。macOS 代理程式的行銷版本與組建編號相同。

## 快速開始

請使用一部實體 Android 或 iOS 手機。模擬器與 Expo Go 不能作藍牙廣播。

1. 從 Google Play 安裝 Android 應用程式，或從原始碼組建手機應用程式。
2. 接受警告、解鎖、選擇型號，並使用不掌管真實資產的秘密資料。
3. 開始廣播，然後讓第三方錢包經藍牙連接。
4. 桌面 WebHID 請啟動 CWS Proxy（macOS 應用程式、Ubuntu 套件的 `cws-proxy`，或在 Linux 執行 `yarn proxy`），再按 Start，並在藍牙清單選擇電話。Chrome 其後可開啟虛擬 USB 裝置。本機頁面是 `http://127.0.0.1:8788`。

按下開始後，代理程式會列出附近的 CWS 電話：廣播名稱、藍牙識別碼，以及作業系統有提供時的 RSSI。請選擇一部電話。在你按下解除鎖定／變更裝置之前，代理程式會鎖定該識別碼。鎖定檔只記藍牙識別碼與廣播名稱，不含種子（macOS 為 `~/Library/Application Support/CWS Proxy/ble-lock.json`，Linux 為 `~/.config/cws-proxy/ble-lock.json`；若已設定 `$XDG_CONFIG_HOME`，則放在其下的 `cws-proxy/ble-lock.json`）。macOS 須在「系統設定 → 私隱與保安 → 藍牙」允許這一份 CWS Proxy。代理程式只轉送位元組。簽署留在手機上。詳見 [security.md](security.md) 與 [proxy-macos.md](proxy-macos.md)。

從原始碼組建需要 Node.js、Yarn 1.22.22，以及用於手機原生組建的 Xcode 或 Android Studio。代理程式的 HID 程式庫亦需要 Rust。

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # 或 run:ios
```

在 Linux 從原始碼執行代理程式，於版本庫根目錄：

```bash
yarn workspace @cws/native-proxy build   # 一次
yarn proxy                               # http://127.0.0.1:8788
```

這條路徑不會安裝套件。請把 `apps/proxy/udev/99-cws-uhid.rules` 複製到 `/etc/udev/rules.d/`，然後重新登入。該規則把 `/dev/uhid` 的群組設為 `plugdev`，模式設為 `0660`。Ubuntu 可以用下面的套件安裝同一條規則。

在 macOS，虛擬 HID 是 CWS Proxy 應用程式。組建與安裝步驟見 [proxy-macos.md](proxy-macos.md)。`yarn proxy` 不會建立該 HID 裝置。

### Ubuntu 安裝包

套件名稱是 `hk.ysk.cws.proxy`。它是供 Ubuntu amd64 與 arm64 使用的 `.deb`（glibc 2.34 或更新：Ubuntu 22.04 與 24.04）。它會安裝：

- `/usr/bin/cws-proxy`
- 放在 `/usr/lib/hk.ysk.cws.proxy` 的私人 Node.js 24 執行環境與代理程式
- `/usr/lib/udev/rules.d/99-cws-uhid.rules`，與 `apps/proxy/udev/99-cws-uhid.rules` 逐位元組相同

`postinst` 在系統沒有 `plugdev` 群組時會建立它，寫入 `/etc/modules-load.d/cws-proxy.conf` 以便核心載入 `uhid`，並執行 `udevadm control --reload-rules`。`/dev/uhid` 的群組是 `plugdev`，模式是 `0660`。若你的帳戶不在 `plugdev`，請先加入，然後重新登入，虛擬 HID 才可使用。

GitHub Release v1.1.0 沒有附上這個 `.deb`。請在 Ubuntu 上組建。[`.github/workflows/cws-proxy-deb.yml`](../.github/workflows/cws-proxy-deb.yml) 會在 `ubuntu-24.04` 組建 amd64、在 `ubuntu-24.04-arm` 組建 arm64，並把每個 `.deb` 上傳為工作流程成品。該成品不是 GitHub Release 的附件。

```bash
sudo apt-get install -y build-essential pkg-config libdbus-1-dev curl ca-certificates python3 xz-utils
# Node.js 22 或更新、Yarn 1.22.22，以及 Rust（rustup）
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
yarn workspace @cws/native-proxy build
bash apps/proxy/linux/build-deb.sh
bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
sudo apt-get install -y ./apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
sudo usermod -aG plugdev "$USER"   # 然後重新登入
cws-proxy                          # http://127.0.0.1:8788
```

在 arm64 Ubuntu，指令稿會按 `uname -m` 選擇 arm64。可用 `--arch amd64` 或 `--arch arm64` 覆蓋。`yarn workspace @cws/proxy deb` 是同一條組建指令稿。

不安裝而檢查封存：

```bash
dpkg-deb -I apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
dpkg-deb -c apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
```

安裝之後，`cws-proxy --help` 應印出用法，`/usr/lib/udev/rules.d/99-cws-uhid.rules` 應與原始碼中的規則相同。要開啟 `/dev/uhid`，帳戶仍須屬於 `plugdev`，並重新登入。完整的 HID 連線還需要手機正在藍牙廣播。

不帶參數執行 `bash apps/proxy/linux/check-deb.sh` 會組建一個結構檢查用的 `.deb`。當中的 Node 二進位檔與原生附加元件只是 ELF 佔位檔。它只供在無法編譯 Linux 附加元件的機器上檢查安裝包結構。請勿安裝。

套件不含種子、金鑰庫或描述檔。種子並非絕對安全。

## 協議範圍

### 裝置型號

| 品牌 | 型號 | 手機傳輸 |
| --- | --- | --- |
| Ledger | Nano X、Flex、Stax、Nano Gen5 | 藍牙 APDU |
| Trezor | Safe 7 | 藍牙 THP |
| OneKey | Classic、Classic 1s、Pure、Touch、Pro（V1）；Pro 2、Neo（V2） | 藍牙 protobuf |

OneKey Mini 沒有藍牙，本軟件不予模擬。

### 其他傳輸

| 傳輸 | 本版本的行為 |
| --- | --- |
| USB HID | macOS 的 CWS Proxy（虛擬 HID），或 Linux 的 Ubuntu 套件 `cws-proxy` 或 `yarn proxy`（`uhid`），把報告經藍牙轉送至手機。沒有 APDU 允許清單。你在 Chrome 授權的網站可以發送手機已實現的任何指令。Phantom 仍可能無法完成解鎖。 |
| Trezor Bridge | 代理程式可在 `http://127.0.0.1:21325` 回應，供相容主機列舉裝置。橋接器會反映請求的 `Origin`。 |
| 二維碼 | 以 UR 及 BBQr 匯出帳戶金鑰與輸出描述符。備份種子二維碼必須經手機確認後才會產生。 |

應用程式按格式提示的掃描對象：

| 格式 | 應用程式指示的掃描位置 |
| --- | --- |
| 帳戶 UR（Keystone 一類及其同系格式） | Rabby、MetaMask |
| 以太坊多帳戶 UR | OKX。Rabby 與 MetaMask 會拒絕此格式。 |
| 比特幣帳戶 | Sparrow 或 BlueWallet，作只供查看的匯入 |
| 比特幣輸出描述符 | Sparrow |
| BBQr xpub | Sparrow，作 Coldcard 二維碼匯入 |
| 備份種子 | 必須先在手機確認。該碼包含秘密資料。 |

指名的主機仍可能掃不到，或無法完成某個畫面。見 [security.md](security.md) 的已知缺口。

### 鏈

預設路徑在 `packages/contracts`。主機可以要求其他路徑。這些鏈有簽署與地址匯出。能夠開啟 Ledger 應用程式名稱，並不表示每個主機的每個畫面均已完成。

| 鏈 | 預設路徑 |
| --- | --- |
| 比特幣傳統 | `m/44'/0'/0'/0/0` |
| 比特幣巢狀 SegWit | `m/49'/0'/0'/0/0` |
| 比特幣原生 SegWit | `m/84'/0'/0'/0/0` |
| 比特幣 Taproot | `m/86'/0'/0'/0/0` |
| 以太坊及 EVM 路徑 | `m/44'/60'/0'/0/0` |
| Avalanche X/P | `m/44'/9000'/0'/0/0` |
| Solana（Ledger） | `m/44'/501'/0'` |
| Solana（Phantom） | `m/44'/501'/0'/0'` |
| Cosmos | `m/44'/118'/0'/0/0` |
| Tron | `m/44'/195'/0'/0/0` |
| XRP | `m/44'/144'/0'/0/0` |
| Cardano | `m/1852'/1815'/0'/0/0` |
| Polkadot | `m/44'/354'/0'/0'/0'` |
| TON | `m/44'/607'/0'/0'/0'/0'` |
| Aptos | `m/44'/637'/0'/0'/0'` |
| Sui | `m/44'/784'/0'/0'/0'` |
| NEAR | `m/44'/397'/0'/0'/1'` |
| 萊特幣 | `m/84'/2'/0'/0/0` |
| 狗狗幣 | `m/44'/3'/0'/0/0` |
| Stellar | `m/44'/148'/0'` |
| Tezos | `m/44'/1729'/0'` |
| BNB Beacon | `m/44'/714'/0'/0/0` |

萊特幣與狗狗幣使用比特幣處理程式。軟件附有 Ledger 應用程式目錄，供主機開啟應用程式名稱，當中包括沒有專用簽署處理程式的名稱。那些名稱會視為未知族系。

設定 → Ledger 目錄可為每個應用程式選擇一個已發布版本。主機向已開啟應用程式查詢版本時，讀到的就是這個版本。CWS 不會因此改用該舊版程式的指令。更新 Ledger 應用程式會按目前選擇的裝置，從 Ledger 公開目錄重新載入名稱與版本。尚未更新時，清單是此組建內置、對應該裝置的目錄。

交易簽署、訊息簽署及備份種子匯出，須在手機上長按確認；正式組建另須通過作業系統認證。公開帳戶或擴展公鑰的讀取亦須確認。一次確認涵蓋該次讀取，以及其後 60 秒內的 15 次公開讀取。它不會簽署。手機廣播期間，裝置畫面會說明已連線的主機可以衍生地址。

## 保安

秘密資料以 `WHEN_UNLOCKED_THIS_DEVICE_ONLY` 儲存。正式組建另設定 `requireAuthentication`。助記詞不會寫入剪貼簿。助記詞與份額畫面沒有複製按鈕。匯入只在確認貼上之後才讀取剪貼簿。正式組建在顯示、匯入、儲存、簽署及匯出種子之前，會要求作業系統認證。Android 正式組建在秘密畫面設定 `FLAG_SECURE`。這些略過只在 `__DEV__` 為真時存在。

這不是硬體錢包級安全。熱錢包基線是朝向 Phantom、Rabby 及 MetaMask 手機版的進度。它不是安全元件。1.1.4 仍保留的相容選擇：

- WebHID 轉送報告時沒有指令允許清單。
- 本機 trezord 橋接器聽 `127.0.0.1`，並反映請求的 `Origin`。
- iOS 在系統報告截圖時顯示警告，不會把即時畫面塗黑。只警告是有意的，因為塗黑亦會塗黑鏡像輸出。
- iOS 不提供 BLE 連結金鑰。

能夠解鎖手機、除錯行程、拍攝螢幕或連上主機的人，所能取得的資料多於介面所顯示。平台限制與已知的主機缺口見 [security.md](security.md)。

## 測試

跑過甚麼、沒有跑過甚麼，見 [testing.md](testing.md)。2026 年 10 月有人報告四次會話，手機是 1.1.0（組建編號 6）：near.com 經 Ledger 藍牙、Core 與 lfj.gg 上一筆 Rabby 交易經 CWS Proxy，以及 app.rhea.finance 經 Ledger 藍牙。每一則只記錄該主機在該路徑上的結果。已知缺口仍然開放。種子並非絕對安全。

## 文件

| 文件 | 內容 |
| --- | --- |
| [../README.md](../README.md) | 英文產品頁 |
| [proxy-macos.md](proxy-macos.md) | 在 macOS 組建 CWS Proxy。尚未在 Mac App Store |
| [security.md](security.md) | 公開保安說明 |
| [testing.md](testing.md) | 測過甚麼、沒有測過甚麼 |
| [releases/README.md](releases/README.md) | 發行說明索引 |
| [releases/1.1.4.md](releases/1.1.4.md) | 1.1.4（組建編號 10）的雙語發行說明 |
| [releases/1.1.3.md](releases/1.1.3.md) | 1.1.3（組建編號 9）的雙語發行說明 |
| [releases/1.1.2.md](releases/1.1.2.md) | 1.1.2（組建編號 8）的雙語發行說明 |
| [releases/1.1.1.md](releases/1.1.1.md) | 1.1.1（組建編號 7）熱錢包基線的雙語發行說明 |
| [releases/1.1.0.md](releases/1.1.0.md) | 1.1.0（組建編號 6）的雙語發行說明 |
| [store/README.md](store/README.md) | Mac App Store 截圖索引 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 工程結構 |
| [ledger-apdu.md](ledger-apdu.md) | Ledger APDU 階段、回應長度，以及 CWS 仍未實現的部分 |
| [vendor-protocols.md](vendor-protocols.md) | Trezor、OneKey 與 QR 的類型字串，包括未實現的部分 |
| [../SECURITY.md](../SECURITY.md) | 如何報告保安問題 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 貢獻、測試，以及不應提交的秘密資料 |
| [../LICENSE](../LICENSE) | MIT 特許。版權屬 YSK Limited |

## 授權

[MIT](../LICENSE)。版權 © 2026 YSK Limited。

授予條款以英文 `LICENSE` 為準。MIT 不會使 CWS 成為安全元件，亦不會使本軟件成為 Ledger、Trezor 或 OneKey 的產品。種子並非絕對安全。請閱讀 [security.md](security.md)。
