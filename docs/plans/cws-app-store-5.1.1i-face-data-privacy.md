# PLAN ONLY — CWS App Store Guideline 5.1.1(i) Face Data

**Status:** plan for Owner approval. Do not treat this file as live policy. Do not edit, merge, or FTP `privacy-policy.php` until YSK Limited (Shek) approves this plan and a later implement PR.

**Product:** Cold Wallet Simulator (CWS), bundle `hk.ysk.cws`  
**Owner / data user:** YSK Limited (Hong Kong) · `privacy@ysk.hk`  
**Plan date:** 9 November 2026 (Asia/Hong_Kong)  
**This repository:** product source and this plan only. The live privacy page lives in the **ysk.hk website tree** (`yanshekki/YSK`, file `privacy-policy.php`), not in this CWS repository.

**Path:** `docs/plans/` (this file). Protocol research plans stay at `docs/ledger-apdu-plan.md` and `docs/full-vendor-parity-plan.md`. This is an App Review / legal plan, so it is kept out of those matrices.

**Seeds are not absolutely safe.** CWS has no secure element. Nothing in the later policy edit may say otherwise.

---

## 1. Goal

Clear Apple App Store Review **Guideline 5.1.1(i) Face data** for CWS by putting Apple’s four Face Data coverage points on the **public privacy policy page itself**, in both English and 繁體中文（香港書面語）, at a URL App Review can open and deep-link.

This plan does **not** change product behaviour, App Store Connect, IPA, Play Console, or live legal copy.

### 1.1 Rejection context

| Item | Value |
| --- | --- |
| Submission | `098ba42a-ab88-4937-bd9d-cf87600702aa` |
| Review date | 2026-11-09 |
| Build under review | 1.1.4 (10) |
| Later builds | 1.1.5 (11), 1.1.6 (12) exist; the rejection is **policy wording**, not those binaries |
| Prior ASC reply | 2026-11-04: CWS does not collect face images / geometry / depth / biometric templates; Face ID is system `LocalAuthentication` (boolean success/fail); camera is wallet QR only |
| Apple’s current bar | the **privacy policy page** must cover Face data; App Store Connect **App Privacy** must link the updated URL |

App Review treats CWS as an app that “uses face data” because iOS declares Face ID (`NSFaceIDUsageDescription`: “Unlock the seed vault”) and camera (`NSCameraUsageDescription`: wallet / air-gap QR). A Resolution Center explanation is not a substitute for on-page policy text.

### 1.2 Guideline 5.1.1(i) — published text

Source: [App Store Review Guidelines — 5.1.1 Data Collection and Storage](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage).

All apps must link a privacy policy in App Store Connect and in the app. The policy must clearly and explicitly:

1. Identify **what data, if any**, the app/service collects, **how**, and **all uses**.
2. Confirm that **any third party** with whom the app shares user data (analytics, ads, SDKs, parent / subsidiary / related entities) will provide the **same or equal protection**.
3. Explain **retention / deletion** and how a user can **revoke consent** and/or **request deletion**.

### 1.3 Apple’s four Face Data coverage points (this rejection)

App Review applies 5.1.1(i) to Face data even when the app collects none. Every point must appear **on the policy page**, in **ZH and EN**, not only in an ASC reply.

| # | Coverage point | CWS fact to state (do not invent) |
| --- | --- | --- |
| 1 | **Collection, use, disclosure** | Whether face data is collected; if not, state non-collection **and** what Face ID / camera actually do |
| 2 | **Sharing and retention** | Sharing policy and retention period; if not collected = **zero / N/A**, stated clearly |
| 3 | **User controls** | How to withdraw consent / delete face data; if not collected: biometrics are managed by iOS; user can disable Face ID in system Settings / delete the app |
| 4 | **Third parties** | Whether face data is shared with third parties; if none, say so; if any, they must provide equivalent protection |

CWS position for all four: **non-collection**. The later copy must say that plainly, then explain Face ID and camera so Review does not read silence as evasion.

---

## 2. Current-state audit (verified 2026-11-09)

### 2.1 Public URL map

| URL | Result | Role |
| --- | --- | --- |
| **https://ysk.hk/privacy-policy** | HTTP 200 | **Canonical.** CWS product footers (ZH+EN) and intended ASC App Privacy URL |
| `https://ysk.hk/en/privacy-policy` | HTTP 404 | No separate EN route. EN product pages already force `url_for('privacy-policy', 'zh-HK')` → `/privacy-policy` |
| `/privacy`, `/legal/privacy`, `/software/privacy`, `/cws/privacy` | HTTP 404 | No dedicated CWS / software / iOS privacy host |
| `/products/ysk-cold-wallet-simulator/privacy` | HTTP 500 | Unrelated rewrite miss. **Do not** invent a CWS-only privacy URL to “fix” this |

The privacy page is a **single bilingual HTML document** (EN first, then ZH), toggled in-page. Canonical tag, Open Graph, and JSON-LD all point at `https://ysk.hk/privacy-policy`.

**Decision:** keep that single canonical URL for ASC. Do not add `/en/privacy-policy`, `/cws/privacy`, or another host.

### 2.2 Source file (ysk.hk website tree, not this repo)

| Field | Live value |
| --- | --- |
| File | `privacy-policy.php` (standalone HTML; language toggle is client-side `switchLang`) |
| Document id | **YSK-LEGAL-2026-V6** |
| Effective | 14 July 2026 |
| Last revised | 22 September 2026 |
| Structure | 16 numbered sections, EN then ZH, A4 “page” wrappers, **no heading `id`s**, **no TOC**, **no hash handling** |
| CWS mention today | §2 Definitions — Products include Cold Wallet Simulator (CWS) / 冷錢包模擬器 |
| Biometric line today | §4 closing paragraph only: “we do not intentionally collect sensitive personal data (e.g. health, biometric…)” / 「我們不會故意收集敏感個人資料（如健康、生物識別…）」 |

That one-line §4 sentence is **insufficient** for Apple’s four Face Data points. There is **no** dedicated Face data / Face ID / LocalAuthentication / camera-QR / “on this device” product subsection.

### 2.3 Gap vs the four points

| Apple point | Present on live page? | Gap |
| --- | --- | --- |
| 1 Collection / use / disclosure of **face data** | No. Generic “no intentional biometric collection” | Does not name Face data, Face ID, LocalAuthentication boolean, or QR camera |
| 2 Sharing and retention of **face data** | No. §9/§10 are company-wide Personal Data | A reviewer can misread 90-day logs / vendor disclosure as applying to face data |
| 3 Withdraw consent / delete **face data** | No. §11 is PDPO access/correction to YSK | Does not say iOS Settings / in-app passcode / delete app, because YSK holds no face data |
| 4 Third-party **face data** sharing | No. §9 lists vendors in general | Does not say CWS shares **no** face data with any third party |

### 2.4 Product facts that the later copy may rely on (CWS source)

Do not exceed these facts.

| Topic | Fact | Where |
| --- | --- | --- |
| Face data | CWS does not collect, process, or store face images, face geometry, depth maps, or biometric templates | Product mandate for this plan; no Vision / TrueDepth / ARKit / face-detect code in the mobile app |
| Face ID / Touch ID | Unlock of the on-device seed-vault gate via `expo-local-authentication`; `authenticateAsync` is used; the app uses the **boolean** `success` (and error string such as `user_cancel`) | `apps/mobile/src/passkeys/session.ts` |
| In-app Face ID toggle | `faceIdEnabled = false` prefers device passcode; it does **not** skip authentication | same file; Settings → Face ID / Touch ID |
| Info.plist | `NSFaceIDUsageDescription`: “Unlock the seed vault” | `apps/mobile/app.json` |
| Camera | Back camera, `barcodeScannerSettings.barcodeTypes: ['qr']`, `onBarcodeScanned` payload is barcode **text**; frames are not uploaded | `apps/mobile/src/qr/QrScanner.tsx` |
| Camera purpose string | “CWS scans wallet QR codes to sign air-gap requests.” | `apps/mobile/app.json` |
| Seeds | Not absolutely safe; **no secure element** | `docs/security.md`, product pages |
| Contact | `privacy@ysk.hk` | live policy footer |

In-app Settings → Privacy (`apps/mobile/src/i18n/locales/en.ts` / `zh-HK.ts`, `privacy.onDeviceBody`) already says Face ID / Touch ID are processed by the operating system. **Apple is not reviewing that screen as the privacy policy URL.** Aligning in-app copy is an optional follow-up in this CWS repo, not required to clear 5.1.1(i).

### 2.5 geo / llms / sitemap (section lists?)

Investigated in the ysk.hk tree. **None hardcode a list of privacy-policy sections.**

| File | What it does | Later implement PR? |
| --- | --- | --- |
| `sitemap.php` | Emits `https://ysk.hk/privacy-policy` with `lastmod` from `privacy-policy.php` mtime | **No source edit.** Lastmod updates after FTP |
| `llms.txt` | One bullet: `Privacy policy: https://ysk.hk/privacy-policy` | **Optional** CWS line with `#face-data`; not required for App Review |
| `includes/geo.php` | About markdown: `Privacy: privacy@ysk.hk — https://ysk.hk/privacy-policy` | **No** |
| `tests/seo_geo_test.php` | Asserts sitemap source contains `privacy-policy` | **No** |
| `includes/footer.php` | Site-wide footer links `/privacy-policy` (forced zh-HK prefix so EN pages do not hit 404) | **No** (do not change to a hash-only URL) |
| `includes/config.php` | Site config / secrets | **Do not overwrite, do not FTP, do not commit secrets** |

---

## 3. Recommended approach

### 3.1 Dedicated 「面容資料／Face Data」 subsection (preferred)

Add a **dedicated bilingual subsection** that App Review can deep-link, rather than stuffing four sentences into the existing §4 biometric line.

**Why a subsection, not a new CWS-only policy host**

- ASC and product footers already use `https://ysk.hk/privacy-policy`.
- `/en/privacy-policy` 404s; a second URL would split Review, footers, and canonical tags.
- Company-wide §4 “no intentional biometric collection” stays true; the new block **clarifies CWS**, it does not carve out a second policy.

**Placement**

Insert the block **immediately after the §4 closing paragraph** (the “no intentional sensitive / biometric collection” sentence) and **before §5**, in both the EN and ZH language trees.

- Apple’s first question is collection; §4 is the collection section.
- It sits next to the only current biometric sentence, so the two cannot drift apart.
- It is still “product / on-device processing” in substance (Face ID and camera never leave the phone as face data).
- **Do not renumber** §§5–16.

Use a distinct heading (`h3` under §4, or a labelled legal block with the same visual weight as `.legal-defense-block`) so Review can quote it. Do not hide it in a footnote.

**Stable HTML anchors (required for App Review deep-link)**

EN and ZH share one HTML document. **Do not reuse the same `id` in both language trees.**

| Language | Heading `id` | Deep-link |
| --- | --- | --- |
| English | `face-data` | `https://ysk.hk/privacy-policy#face-data` |
| 繁體中文 | `面容資料` | `https://ysk.hk/privacy-policy#面容資料` |

Today `switchLang` only toggles `display`; the ZH tree is `display: none` until clicked. Native hash scroll to `#面容資料` will fail unless the later implement PR:

1. On load and on `hashchange`, if hash is `面容資料` → `switchLang('zh')`, if `face-data` → `switchLang('en')`.
2. Then `scrollIntoView` the matching element (ZH node is in the DOM even when hidden).
3. Optional: a one-line jump under the document-id line (not a full 16-section TOC), e.g. `CWS Face Data: #face-data` / `CWS 面容資料：#面容資料`.

Also add stable ids on the cross-linked headings (§4, §9, §10, §11, §14) in **each** language tree with distinct suffixes (`section-4` / `第4條`, etc.) so in-page links work.

### 3.2 Cross-links (no contradictions)

The new subsection must **reinforce** §4, not punch a hole in it.

| Existing text | How the Face Data block relates |
| --- | --- |
| **§4** “We do not intentionally collect sensitive personal data (e.g. health, biometric…)” | Keep the sentence. Add one pointer: for CWS Face ID, Touch ID, and camera, see Face Data. The subsection states CWS **does not collect** face data, which is the same position, named for Apple. |
| **§9** Disclosure, sub-processors, third parties | Face Data block: CWS does not disclose face data to anyone listed in §9 (or any other third party), because it never obtains face data. Do not let a reviewer apply §9’s vendor list to Face data. |
| **§10** Retention (90-day logs, 7-year billing, …) | Face Data block: retention of face data is **zero / not applicable**. §10 periods do **not** apply to face data. |
| **§11** PDPO access/correction via `privacy@ysk.hk` | Face Data block: YSK holds no face data to access, correct, or delete. User control is iOS Settings / in-app passcode preference / delete app. Other Personal Data still follows §11. |
| **§14** Software disclaimer, as-is, liability cap | Face Data block must not convert Face ID into a security warranty. Point at §14: Face ID is an OS gate, not a secure element, not absolute seed safety. |

### 3.3 Canonical URL and ASC (Owner, after go-live)

| Item | Decision |
| --- | --- |
| Public / ASC Privacy Policy URL | **`https://ysk.hk/privacy-policy`** (unchanged host and path) |
| Review convenience | Resolution Center reply may quote `https://ysk.hk/privacy-policy#face-data` and the ZH twin |
| ASC form | **Out of scope for implement.** Owner re-saves App Privacy after FTP so Review re-fetches; same URL is enough; do not invent a new listing URL |
| In-app link | Product already has an in-app privacy screen; 5.1.1(i) also requires the **metadata** URL. No IPA work in the implement PR |

### 3.4 Version bump (implement PR)

| Field | Now | Later |
| --- | --- | --- |
| Document id | `YSK-LEGAL-2026-V6` | **`YSK-LEGAL-2026-V7`** (title, meta description, EN/ZH headers, both footers) |
| Effective Date | 14 July 2026 | **unchanged** (this is a revision, not a new commencement) |
| Last Revised | 22 September 2026 | **go-live date** (Owner sets on approval; if same calendar day as FTP, 9 November 2026 or the actual FTP day) |

A4 pagination: EN and ZH are “Page *n* of 4” / 「第 *n* 頁，共 4 頁」with print CSS locking `.a4-page` to 297 mm. The new block will overflow page 2. The implement PR must **reflow pages** and fix page-of-N (likely 5). Do not clip legal text in print.

---

## 4. Suggested heading titles

Use these as the subsection titles (ZH = 香港書面語; keep the English product names Face ID / CWS).

| Lang | Recommended `h3` |
| --- | --- |
| EN | Face Data — Cold Wallet Simulator (CWS) |
| ZH | 面容資料 — 冷錢包模擬器（CWS） |

Short toolbar / header jump labels: **Face Data** / **面容資料**.

Do not title the block “Biometric data we collect” or “How we use Face ID data” — both imply collection.

---

## 5. English outline (all four Apple points)

Outline level only. Not final legalese. Implement PR writes full sentences from this list.

**Lead.** This subsection applies to the YSK Product **Cold Wallet Simulator (CWS)** on iOS. It does not change the company-wide statement in §4 that YSK does not intentionally collect sensitive personal data (including biometric data) unless a separate written engagement requires it.

### 5.1 Point 1 — Collection, use, disclosure

- CWS **does not collect, process, or store face data**. That includes face images, face geometry, depth maps, and biometric templates.
- **Face ID / Touch ID:** CWS calls the operating-system LocalAuthentication API to gate the **on-device seed vault** (unlock, and again before reveal / import / save / sign / seed export in a release build). The app receives **only a boolean result** (success or failure). It does not receive a face image, a face map, or a template.
- **Camera:** used **only** to scan **wallet / air-gap QR barcodes**. CWS does not run face detection. Preview frames are **not uploaded** to YSK or to any server.
- Because no face data is obtained, CWS **does not use or disclose** face data.

### 5.2 Point 2 — Sharing and retention

- **Sharing:** none. There is no face data to share.
- **Retention:** **zero / not applicable.** YSK does not retain face data for any period.
- The retention periods in **§10** (technical logs, billing, News, backups) **do not apply to face data**.

### 5.3 Point 3 — User controls

- YSK **cannot** withdraw consent over, or delete, face data **because it does not hold any**.
- Face ID / Touch ID biometrics are **managed by iOS**. The user may disable Face ID for CWS (or for the device) in **system Settings**, prefer device passcode in **CWS Settings**, or **delete the app**.
- Access and correction of Personal Data that YSK actually holds remain as in **§11** (`privacy@ysk.hk`).

### 5.4 Point 4 — Third parties

- CWS **does not share face data with any third party** (no analytics SDK, advertising network, parent, subsidiary, or other related entity receives face data from CWS).
- There is **no** third-party recipient that stores CWS face data, so there is no third-party Face Data retention schedule to disclose.
- Apple’s Face ID / Touch ID subsystem is part of **iOS**, under **Apple’s** terms. That is operating-system authentication, **not** YSK collecting face data and sharing it with Apple.
- Third-party platforms named in **§9** (cloud, app stores, messaging, blockchain) **do not receive face data from CWS**.

---

## 6. Chinese outline (all four Apple points)

香港書面語。稱謂用「您」（與現行 `privacy-policy.php` 一致）。用語固定：**面容資料**、**Face ID**、**Touch ID**、**本機**、**生物識別**、**冷錢包模擬器（CWS）**。

**開首。** 本分節適用於 YSK 產品「冷錢包模擬器（Cold Wallet Simulator／CWS）」之 iOS 版本。此分節並不修改第 4 條所述之公司整體立場：除非另有書面項目需要，我們不會故意收集敏感個人資料（包括生物識別資料）。

### 6.1 第 1 點 — 收集、使用及披露

- CWS **並不收集、處理或儲存面容資料**，包括面容影像、面容幾何、深度圖或生物識別模板。
- **Face ID／Touch ID：** CWS 呼叫作業系統 LocalAuthentication 介面，用以把關**本機種子庫閘門**（解鎖；發行組建並於顯示、匯入、儲存、簽署或匯出種子前再次把關）。本應用程式**只收取成功或失敗之布林結果**，並不取得面容影像、面容圖或模板。
- **相機：** **僅**用於掃描**錢包／隔空（air-gap）二維碼**。CWS **並無面容偵測**；畫面格**並不上載**至 YSK 或任何伺服器。
- 因並未取得面容資料，CWS **並不使用或披露**面容資料。

### 6.2 第 2 點 — 分享及保留

- **分享：** 無。並無面容資料可供分享。
- **保留：** **零／不適用。** YSK 並不就任何期間保留面容資料。
- 第 10 條之保留期（技術日誌、帳單、新聞、備份）**並不適用於面容資料**。

### 6.3 第 3 點 — 使用者控制

- 因 YSK **並未持有**面容資料，故**無法**就面容資料撤回同意或辦理刪除。
- Face ID／Touch ID 生物識別由 **iOS** 管理。您可於**系統「設定」**停用 CWS（或本機）之 Face ID，於 **CWS 設定**改為使用裝置密碼，或**刪除本應用程式**。
- YSK 實際持有之其他個人資料，查閱及更正仍按**第 11 條**（`privacy@ysk.hk`）。

### 6.4 第 4 點 — 第三方

- CWS **並不與任何第三方分享面容資料**（分析 SDK、廣告網絡、母公司、附屬公司或其他關聯實體均不從 CWS 接收面容資料）。
- **並無**接收並儲存 CWS 面容資料之第三方，故無需披露第三方之面容資料保留安排。
- Apple 之 Face ID／Touch ID 子系統屬 **iOS**，受 **Apple** 條款規管。此為作業系統認證，**並非** YSK 收集面容資料後再分享予 Apple。
- 第 9 條所述之第三方平台（雲端、應用商店、訊息、區塊鏈）**並不從 CWS 接收面容資料**。

---

## 7. Explicit non-claims

The implement PR must **not** say or imply any of the following.

| Forbidden claim | Correct position |
| --- | --- |
| CWS has a **secure element (SE)** | CWS has **no** secure element. Face ID’s use of Apple hardware is Apple’s, not a CWS SE. |
| Seeds are **absolutely safe** / hardware-wallet safe | **Seeds are not absolutely safe.** Face ID is an OS gate, not a vault warranty. Cross-link §14. |
| CWS **uploads** or **stores** face images | It does not. |
| Camera “never sees a face” | Do not promise that. State: **no face detection**; **QR barcode text only**; **frames not uploaded**. |
| CWS **shares face data with Apple** (or any third party) | It does not obtain face data, so it does not share it. OS Face ID ≠ CWS disclosure. |
| §10 90-day (or any) retention **of face data** | Retention is **zero / N/A**. |
| YSK can **delete Face ID templates** on request | Templates are not held by YSK; user uses iOS Settings / delete app. |
| This policy change **makes the app safer** | It is a disclosure. It is not a security upgrade. |
| New product behaviour (TrueDepth, liveness, face match, cloud KYC) | **Out of scope.** Do not invent behaviour to justify Face Data collection language. |

---

## 8. Files for the later implement PR

The later PR belongs in the **ysk.hk website repository** (`yanshekki/YSK`), not this CWS product repository.

### 8.1 Must change

| File | Change |
| --- | --- |
| **`privacy-policy.php`** | ZH+EN Face Data subsection; anchors; §4 pointer; optional header jump; `switchLang` + hash; version id **V7**; Last Revised; A4 page reflow; meta description may mention Face Data for CWS |

### 8.2 Do not change (unless Owner later asks)

| File | Why |
| --- | --- |
| `includes/config.php` | Secrets / site config. **Do not overwrite. Do not FTP.** |
| `includes/footer.php` | Already canonical `/privacy-policy` |
| `sitemap.php` | Lastmod follows file mtime after FTP |
| `llms.txt` / `includes/geo.php` | URL only; no section list. Optional `#face-data` mention is not required for Apple |
| `.htaccess` | Do not add `/en/privacy-policy` or `/cws/privacy` |
| This CWS repo (`apps/mobile/...`) | No IPA, no in-app string change required to clear 5.1.1(i) |
| App Store Connect / Play Console | Owner-only, after go-live |

### 8.3 Optional follow-ups (separate PRs, not Apple-blocking)

- CWS in-app `privacy.onDeviceBody` (en + zh-HK): one sentence that face data is not collected, with a link to `https://ysk.hk/privacy-policy#face-data`.
- `llms.txt` CWS bullet: Face Data deep-link.
- Fix HTTP 500 on `/products/ysk-cold-wallet-simulator/privacy` so it 404s instead of 500 — **not** by publishing a second policy.

---

## 9. Implementation checklist (later PR, after Owner approval)

Copy only. **This PR does not perform these steps.**

1. Owner (Shek / YSK Limited) **approves this plan** (this document).
2. Open an implement branch in **`yanshekki/YSK`**, not here.
3. Draft ZH+EN from §§5–6; keep 您 / Face ID / 面容資料 / 本機 / 生物識別 consistent; apply §7 non-claims.
4. Edit **`privacy-policy.php` only** (plus optional one-line header jump / heading ids / hash script in that same file).
5. Bump **YSK-LEGAL-2026-V6 → V7**; set Last Revised; keep Effective Date 14 July 2026.
6. Add `#face-data` and `#面容資料`; wire hash → language switch + scroll.
7. Pointer from §4 biometric sentence; cross-links to §9, §10, §11, §14 without weakening them.
8. Reflow A4 pages; fix “Page *n* of *N*” in both languages.
9. `php -l privacy-policy.php`
10. Preview in a browser: EN default, ZH toggle, `#face-data`, `#面容資料` (ZH must become visible).
11. `curl -sI https://ysk.hk/privacy-policy` remains 200 **after** FTP; `curl -s https://ysk.hk/privacy-policy | grep` the new ids **after** FTP. Do not curl-check production before FTP and call it done.
12. **Do not** overwrite live `includes/config.php`.
13. **FTP `privacy-policy.php` only**, after Owner approval of the implement wording.
14. Owner: App Store Connect → App Privacy → Privacy Policy URL = `https://ysk.hk/privacy-policy` (re-save even if unchanged) → Resolution Center reply quoting the Face Data subsection (EN + ZH) and the deep-link.
15. Do **not** upload IPA, edit Play Console, or merge this plan as if it were live policy.

---

## 10. Out of scope

- Editing live `privacy-policy.php` in **this** PR
- Merging this plan as a substitute for legal copy
- FTP
- App Store Connect form fields, nutrition labels, or binary upload
- IPA / TestFlight / Play Console
- Inventing new product behaviour (face capture, TrueDepth, cloud biometrics)
- Creating `/en/privacy-policy` or a CWS-only privacy host
- Rewriting §§1–16 beyond the §4 pointer, anchors, version line, and pagination
- Claiming SE or absolute seed safety

---

## 11. Success criteria (this plan PR)

- Plan file committed at `docs/plans/cws-app-store-5.1.1i-face-data-privacy.md`
- Each of Apple’s four points maps to proposed ZH **and** EN outline language (§§5–6)
- Dedicated Face Data subsection + canonical URL `https://ysk.hk/privacy-policy`
- Concrete implement file list (`privacy-policy.php` primary)
- **No** `privacy-policy.php` wording in this PR

---

## 12. Owner approval gate

| Approve | Then |
| --- | --- |
| Shek / YSK Limited signs off this plan | Open the YSK-site implement PR from §§4–9 |
| Requested edits to outlines | Revise **this** plan first; still no live policy FTP |
| Reject / defer | Leave V6 live; do not half-edit §4 |

Contact for the live policy remains **privacy@ysk.hk**.
