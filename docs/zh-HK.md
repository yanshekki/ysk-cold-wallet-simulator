# YSK Cold Wallet Simulator

**版本 1.1.0（組建編號 6）** · YSK Limited · 套件識別碼 `hk.ysk.cws`

CWS 是一款在實體手機上運行的冷錢包模擬器。手機以藍牙周邊裝置的形式，模擬指定的 Ledger、Trezor 及 OneKey 型號，並把 BIP39 或 SLIP-39 秘密資料存放於作業系統的安全儲存。桌面代理程式可把該手機呈現為 USB HID 裝置。帳戶資料亦可以二維碼作氣隙匯出。

本軟件供開發及互通測試之用。它不是安全元件，亦未獲 Ledger、Trezor 或 OneKey 認可。請勿以本軟件保管真實數碼資產。

English: [../README.md](../README.md)

**種子並非絕對安全。** 產生或匯入秘密資料之前，請先閱讀下文〈保安模型〉。

## 產品範圍

### 裝置型號

| 品牌 | 型號 | 手機傳輸 |
| --- | --- | --- |
| Ledger | Nano X、Flex、Stax、Nano Gen5 | 藍牙 APDU |
| Trezor | Safe 7 | 藍牙 THP |
| OneKey | Classic、Classic 1s、Pure、Touch、Pro（V1）；Pro 2、Neo（V2） | 藍牙 protobuf |

OneKey Mini 沒有藍牙，本軟件不予模擬。

### 其他傳輸

- **USB HID。** macOS 上的 CWS Proxy（虛擬 HID）或 Linux 上的 `yarn proxy`（`uhid`）把報告轉送至手機。Chrome WebHID 客戶端（包括 MetaMask、Rabby、Phantom、Keplr）可使用該裝置。代理程式不會篩選 APDU。見〈保安模型〉。
- **Trezor Bridge。** 代理程式可在 `http://127.0.0.1:21325` 回應，供相容主機列舉裝置。橋接器會反映請求的 `Origin`。
- **二維碼。** 以 UR 及 BBQr 匯出帳戶金鑰、輸出描述符，以及（必須經手機確認後）備份種子。能否掃描視格式而定，相關主機包括 Rabby、MetaMask、Sparrow、BlueWallet 及 OKX。

### 鏈

衍生與簽署涵蓋比特幣（傳統、巢狀 SegWit、原生 SegWit、Taproot）、以太坊及 EVM 路徑、Avalanche、Solana（Ledger 與 Phantom 路徑）、Cosmos、Tron、XRP、Cardano、Polkadot、TON、Aptos、Sui、NEAR、萊特幣、狗狗幣、Stellar、Tezos 及 BNB Beacon。軟件附有 Ledger 應用程式目錄，供主機開啟應用程式名稱。能夠開啟名稱，並不表示該鏈在每個主機介面上均已完成。

交易或訊息的簽署，以及備份種子的匯出，須在手機上長按確認；正式組建另須通過作業系統認證。列出地址及匯出擴展公鑰則保持靜默，因為上述錢包以此方式列出帳戶。

## 保安模型

### 軟件實際做的事

- 新的 BIP39 或 SLIP-39 秘密資料來自作業系統的密碼學安全隨機數。助記詞與份額只在畫面上顯示，以便抄寫，不會寫入剪貼簿。輸入助記詞、份額、熵、核對詞或密語的欄位已關閉系統複製選單。匯入時仍可按「貼上」讀取剪貼簿。
- 儲存的是熵（或 SLIP-39 秘密），使用 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`。網頁組建拒絕寫入。密語只存在於該工作階段的記憶體，鎖定時清除。
- 正式組建在顯示、匯入、儲存或套用密語之前，以及在簽署或匯出備份種子二維碼之前，會要求作業系統認證（生物識別或裝置密碼）。除錯組建略過顯示時的提示，以便實驗室操作。除錯組建的簽署與種子匯出依設定開關；正式組建即使關閉該開關仍會詢問。
- 種子庫、匯入、產生、密語表、備份種子二維碼及種子匯出確認均為秘密畫面。Android 正式組建在這些畫面設定 `FLAG_SECURE`。Android 除錯組建不設定，以便品質檢查截圖。iOS 會模糊應用程式切換器，並在系統報告截圖時顯示警告。iOS 不會把即時畫面塗黑。
- 已遮罩的密語欄位只向無障礙功能提供欄位名稱，不提供秘密本身。可見的助記詞仍留在無障礙樹，以便抄寫。秘密畫面開啟時，螢幕閱讀器可以讀出這些詞語。

### 為相容而保留的風險

以下項目若關閉，真實錢包將無法連線或無法列出帳戶。1.1.0 並不宣稱已消除這些風險。

**WebHID。** 代理程式把 HID 報告原樣轉成 APDU，沒有指令允許清單。你在 Chrome 授權的網站可以發送手機已實現的任何指令，包括靜默讀取地址或擴展公鑰。簽署與種子匯出仍須手機確認。

**trezord。** 橋接器只聽 `127.0.0.1`，並反映請求的 `Origin`（沒有 Origin 時為 `*`）。Trezor 相容主機需要此行為。代理程式運行時，同一部電腦上的瀏覽器來源都可以呼叫橋接器。簽署仍須在手機確認。

**靜默公鑰匯出。** 以太坊 `GET_ADDRESS` 在 P1=0、Solana 公鑰在 P1=0、比特幣擴展公鑰，以及其他應用程式的同類指令，均不逐筆確認。若指令包含鏈碼，主機可以繼續衍生公開子金鑰。這不是種子。若每個帳戶都要確認，上述錢包不會完成列出帳戶。顯示地址（P1=1）仍會確認。手機廣播期間，裝置畫面會說明已連線的主機可以衍生地址。

**並非每次讀取都要求生物識別。** 熵項目沒有設定 `requireAuthentication`。該 API 會在每次讀取時提示，而主機列出帳戶時程式必須讀取熵。該提示會中斷列出帳戶，並在 iPhone 鏡像輸出下失敗。裝置解鎖後，應用程式行程可以讀取該項目，而不再詢問生物識別。工作階段解鎖，以及正式組建的顯示與簽署提示，是應用程式層的檢查，不是鑰匙圈存取控制。

### 平台限制

- **iOS 截圖。** 若呼叫系統的擷取阻擋，畫面在鏡像輸出或控制中心擷取時會被塗黑。CWS 不這樣做。另一部相機仍可拍下螢幕。程式沒有輪詢擷取狀態。
- **iOS 藍牙鏈路金鑰。** 作業系統不提供該金鑰。沒有鏈路金鑰時，簽署仍須確認主機。iOS 上的連線並不綁定作業系統的配對金鑰。
- **除錯權限。** `SYSTEM_ALERT_WINDOW` 已從除錯與正式清單移除。除錯組建仍允許明文流量，以便 Metro 載入套件。正式組建不會合併除錯清單。截圖監聽使用 `DETECT_SCREEN_CAPTURE`，這不是浮動視窗權限。
- **正式簽署。** 正式套件從環境讀取 `CWS_UPLOAD_STORE_FILE` 及對應的密碼、別名與金鑰密碼。版本庫沒有金鑰庫。變數未設定時，正式包裝會失敗，而不會改用除錯金鑰。除錯手機不能證明正式組建的認證提示。

### 已知的主機缺口

下列行為在 1.1.0 並未完成，屬可用性缺口，不是放寬靜默列出帳戶的理由：

- Phantom 連線後可能無法完成解鎖。
- 在部分環境，Rabby 的相機可能無法掃到手機二維碼。
- Core 可能無法完整列出 Avalanche X 與 P 帳戶。
- OKX 可能無法顯示已匯入帳戶的資產餘額。

地址匯出與簽署表由自動測試涵蓋，見 [testing.md](testing.md)。不應期望 Ledger Live 的正品檢查通過。CWS 不是 Ledger Live、Trezor Suite 或 OneKey 應用程式。

讀者應假設：能夠解鎖手機、除錯行程、拍攝螢幕或連上主機的人，所能取得的資料多於介面所顯示。任何在此輸入的秘密資料，均應視為已不適合用於重要用途。

## 組建與運行

需要 Node.js、Yarn 1.22.22，以及一部實體 Android 或 iOS 手機。原生組建需要 Xcode 或 Android Studio。

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # 或 run:ios
```

模擬器與 Expo Go 不能作藍牙廣播。

桌面代理程式：

```bash
yarn workspace @cws/native-proxy build   # 一次；需要 Rust
yarn proxy                               # http://127.0.0.1:8788
```

在手機選擇型號與種子，然後開始廣播。在代理程式頁面按 Start，再以虛擬 USB 連接錢包，或使用測試網主機分頁。Linux HID 需要 `apps/proxy/udev/99-cws-uhid.rules`。

macOS 應用程式位於 `apps/proxy/macos/CWSProxy`（`hk.ysk.cws.proxy`）：

```bash
yarn workspace @cws/proxy app
```

該指令使用 Xcode 專案已設定的團隊。若必須指定證書名稱，請設定 `CWS_CODESIGN_IDENTITY`，需要時再設定 `CWS_PROFILE_SPECIFIER`。`apps/proxy/macos/pack.sh` 另需 `CWS_CODESIGN_IDENTITY` 與 `CWS_PROFILE`。請勿把描述檔或金鑰庫提交至版本庫。

上架用的 Android 正式組建讀取 `CWS_UPLOAD_STORE_FILE`、`CWS_UPLOAD_STORE_PASSWORD`、`CWS_UPLOAD_KEY_ALIAS` 及 `CWS_UPLOAD_KEY_PASSWORD`。商店檔案未設定時，正式包裝失敗。本版本庫沒有金鑰庫。

產品版本 **1.1.0** 與組建編號 **6** 來自 `apps/mobile/app.json` 的 `version`、`versionCode` 及 `buildNumber`。Expo prebuild 會寫入 Android 的 `versionName`／`versionCode`，以及 iOS 的 `CFBundleShortVersionString`／`CFBundleVersion`。隨應用程式發行的工作區套件版本同為 `1.1.0`。macOS 代理程式的行銷版本與組建編號相同。

## 測試

```bash
yarn test
cd apps/proxy && yarn test:e2e
```

Maestro 涵蓋手機介面與代理程式外殼，不包括藍牙廣播。Java 須在 `PATH`。實機檢查過甚麼、沒有檢查甚麼，見 [testing.md](testing.md)（英文紀錄，截圖為空白匯入畫面）。

2026 年 10 月曾在一部 Android 16 手機安裝當時的除錯組建（`versionName` 1.0.4，即本版本所發佈的程式）。該次檢查確認除錯 APK 沒有 `SYSTEM_ALERT_WINDOW`；空白匯入欄長按不會出現系統複製選單；系統截圖會顯示 CWS 已偵測到截圖。正式組建的作業系統認證沒有在裝置上執行，因為上架金鑰庫環境變數未設定。1.1.0 本身是版本、文件與清理，並沒有另一次實機驗收。

## 授權與貢獻

版權屬 YSK Limited，保留所有權利。見 [../LICENSE](../LICENSE)。貢獻方式見 [../CONTRIBUTING.md](../CONTRIBUTING.md)。工程結構見 [ARCHITECTURE.md](ARCHITECTURE.md)。
