# YCH Physio Dept 排更系統 — 部署指南 Deploy Guide

本系統 = **Google Sheet（資料庫）+ Apps Script Web App（後端 API）+ GitHub Pages（前端網站）**。
一次過設定，之後同事只需開網址使用。此為 **YCH Physio Dept 獨立專案**，與其他平台無關。

---

## 架構 Architecture

```
┌─────────────────┐   快讀 gviz JSON    ┌──────────────────────┐
│  前端 (GitHub    │ ──────────────────▶ │  Google Sheet (DB)   │
│  Pages, React)  │                     │  YCH_Physio_Roster   │
│                 │   寫入/規則檢查 POST  └──────────────────────┘
│                 │ ──────────────────▶ ┌──────────────────────┐
└─────────────────┘                     │ Apps Script Web App  │
                                        │ (Code.gs 後端 API)    │
                                        └──────────────────────┘
```
- **讀取**：前端直接用 gviz JSON 讀 Sheet（快，避開 Apps Script 冷啟動 6 秒問題）。
- **寫入 + 規則檢查 + 權限**：全部經 Apps Script `Code.gs`。
- Sheet 內原有 formula（STATUS / Fail Reason）= 規則的唯一真相來源。

---

## 第 1 步：上載 Google Sheet 資料庫

1. 開啟 `YCH_Physio_Roster.xlsx`（本次提供的檔案）。
2. 上載到 Google Drive → 用 Google Sheets 開啟 → **檔案 ▸ 另存為 Google She表**（或直接 import 到你現有的 Sheet）。
3. 記下網址中的 **Sheet ID**（`/spreadsheets/d/<這一段>/edit`）。
4. **共用**：右上「共用」→「任何知道連結的人」→ **檢視者 Viewer**（前端快讀需要公開檢視；寫入仍受 token 保護）。

> 你現有的 Sheet ID：`1w6T9akUXB5b-TiUDBb_LzhWcUCeF4GT5ICaZ_4eg8Z8`

---

## 第 2 步：安裝 Apps Script 後端

1. 在該 Google Sheet 內：**擴充功能 Extensions ▸ Apps Script**。
2. 刪除預設 `Code.gs` 內容，貼上本次提供的 **`Code.gs`** 全部內容，儲存。
3. 左邊 **專案設定 Project Settings ▸ Script Properties ▸ Add script property**，加入兩個：
   | Property | Value |
   |---|---|
   | `ADMIN_TOKEN` | `ychphysioadmin` |
   | `STAFF_TOKEN` | `ychphysio` |
   （token 存喺 Script Properties，唔會出現喺 GitHub 公開碼。日後改 token 只改呢度。）
4. **部署 Deploy ▸ 新增部署 New deployment**：
   - 類型 Type：**Web app**
   - 執行身分 Execute as：**Me（你自己）**
   - 誰可存取 Who has access：**Anyone**
   - 按 Deploy，授權（第一次會要求 Google 帳戶授權）。
5. 複製 **Web app URL**（結尾 `/exec`）。呢個就係前端要用嘅 API 網址。

> 授權「匯入香港公眾假期」功能需要 Calendar 權限，第一次執行時一併批准即可。

---

## 第 3 步：設定並發佈前端 (GitHub Pages)

1. 打開前端資料夾 `ych-roster-web/`，編輯 `src/lib/config.js`：
   ```js
   export const API_URL  = 'https://script.google.com/macros/s/xxxxx/exec'; // 第 2 步的 /exec
   export const SHEET_ID = '1w6T9akUXB5b-...';                              // 第 1 步的 Sheet ID
   ```
   （或用環境變數 `VITE_API_URL` / `VITE_SHEET_ID`。）
2. 在專案根目錄執行：
   ```bash
   npm install
   npm run build      # 產生 dist/
   ```
3. 發佈到 GitHub Pages（兩種方法擇一）：

   **方法 A — gh-pages 分支（最簡單）**
   ```bash
   npm install -D gh-pages
   npx gh-pages -d dist
   ```
   然後 GitHub repo ▸ Settings ▸ Pages ▸ Source 選 `gh-pages` 分支 `/root`。

   **方法 B — GitHub Actions**
   加一個 workflow，push 到 main 時自動 build + deploy `dist/`（可另外提供）。

4. 網站網址：`https://<你的帳戶>.github.io/<repo>/`。
   > 前端已用 hash routing（`#/`）+ `base: './'`，可直接在 GitHub Pages 子路徑運作。

---

## 第 4 步：登入使用

- Admin 管理員 token：`ychphysioadmin`（可生成、隨機化、改員工資料、批公眾假期、force override）。
- Staff 員工 token：`ychphysio`（睇全部；只可換 Sat/Sun 更、編輯 PH/SH/RD/SHS、每日點名 + workload）。

---

## 每年續期 New Year Rollover

1. 用 Admin 登入 → **生成 Generate ▸ Generate Calendar** → 輸入新年份（例如 2027）→ 系統會複製 `CAL_2026` 格式並填滿新年日期，建立 `CAL_2027`。
2. 再按 **Generate Roster** 揀年份及月份範圍，自動按 (Round, Order) 填 PH/RD/SH/Sun 更；未能符合規則的日子會標記 **NEEDS ADMIN（紅）**由你手動處理。
3. Rotation pointer 會跨年延續（記錄在 Change_Log）。

---

## 疑難 Troubleshooting

| 問題 | 解決 |
|---|---|
| 前端讀唔到資料 | 確認 Sheet 已設「任何知道連結的人 — 檢視者」；確認 `SHEET_ID` 正確 |
| 寫入回傳 `unauthorized` | token 打錯，或 Script Properties 未設定 |
| 寫入回傳 CORS 錯誤 | 前端已用 `text/plain` 避免 preflight；確保 Web app 部署為「Anyone」 |
| 改咗 Code.gs 冇效 | 要 **重新 Deploy ▸ Manage deployments ▸ Edit ▸ New version** |
| 匯入假期失敗 | 第一次要授權 Calendar 權限 |

---

## 安全備註 Security note

- Phase-1 用簡單 token，適合內部部門使用。Token 只存 Apps Script Script Properties，不入 GitHub。
- 需要更高安全性時，Phase-2 可改用 Google 帳戶登入（OAuth）或將資料鏡射到 Supabase 做毫秒級讀取 + row-level security。
