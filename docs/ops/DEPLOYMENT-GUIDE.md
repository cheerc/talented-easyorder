# EasyOrder 正式部署指南

> 適用情境：第一次部署到 production（全新空資料庫），使用 talented-payroll 的 Firebase project。

## 前置條件

- [ ] 前端功能已手動測試完成（`./workflow.sh d3` 本地 + prod Firebase）
- [ ] 所有 unit tests 通過（`./workflow.sh t6`）
- [ ] Firebase CLI 已安裝且登入 `cheerc@gmail.com`
- [ ] Vercel CLI 已安裝且已連結 project
- [ ] gcloud CLI 已登入 `cheerc@talented.com.tw`

---

## ⚠️ 共用資源警告

EasyOrder 與 talented-payroll **共用同一個 Firebase project**：`gen-lang-client-0613258198`

| 資源 | 共用狀態 | 部署注意事項 |
|------|----------|--------------|
| Firestore Rules | ⚠️ 同一份檔案 | **必須合併兩邊 rules 再部署，否則互蓋** |
| Firestore Database | 同一個 DB | Collections 不同，不衝突 |
| Firestore Indexes | 同一個 project | Additive，不會刪除既有 index |
| Firebase Auth | 同一套 | Auth pattern 不同（payroll: `roles`，easyorder: `operators`） |
| Firebase Functions | 只有 payroll 有 | EasyOrder 不部署 Functions |
| Hosting | 不同 | Payroll: Firebase Hosting / EasyOrder: Vercel |

---

## 部署步驟（按順序執行）

### Step 1：合併並部署 Firestore Rules

**為什麼要合併**：Firebase project 只有一份 rules file。直接部署 easyorder 的 rules 會覆蓋 payroll 的 rules，反之亦然。

```bash
cd ~/talented-easyorder
./workflow.sh p2
```

workflow.sh 會自動：
1. 讀取 `~/talented-payroll/firestore.rules`（payroll 的 rules）
2. 讀取 `./firestore.rules`（easyorder 的 rules）
3. 用 Python 合併成一份（payroll rules + easyorder rules 並存）
4. 部署合併後的 rules 到 `gen-lang-client-0613258198`
5. 部署完後還原本地 `firestore.rules`（不修改 git tracked 版本）

**驗證**：
```bash
firebase firestore:rules --project gen-lang-client-0613258198
# 或在 Firebase Console > Firestore > Rules 確認兩邊 rules 都在
```

**⚠️ 後續注意**：
- 之後 payroll 的 `workflow.sh p3`（部署 rules）也需要加入同樣的 merge 邏輯，否則會蓋掉 easyorder 的 rules
- 目前 payroll 的 workflow.sh **尚未修改**，在修改之前**不要從 payroll 側部署 rules**

---

### Step 2：部署 Firestore Indexes

```bash
cd ~/talented-easyorder
./workflow.sh p3
```

部署 `firestore.indexes.json` 中定義的 3 個 composite indexes：
- `transactions`: businessDate + createdAt
- `transactions`: studentId + createdAt
- `cash_adjustments`: businessDate + createdAt

Index 是 additive 的，不會影響 payroll 既有的 indexes。

**注意**：Index 建立需要幾分鐘時間，Firebase Console 會顯示 "Building"。

---

### Step 3：建立初始資料（operators collection）

EasyOrder 使用 `operators` collection 控制誰可以登入操作。**全新資料庫不會有這個 collection**，所以第一個 operator 需要手動建立。

**方式 A：Firebase Console 手動建立**

到 Firebase Console > Firestore > 新增 collection `operators`，新增 document：

```
Document ID: <使用者的 Firebase Auth UID>
Fields:
  uid: string = "<同上的 UID>"
  email: string = "xxx@talented.com.tw"
  displayName: string = "管理員名稱"
  role: string = "admin"
  active: boolean = true
  createdAt: timestamp = <now>
  updatedAt: timestamp = <now>
```

**方式 B：用 Firebase Admin SDK script**（未來可寫一個 seed script）

**如何取得 UID**：
1. 到 Firebase Console > Authentication > Users
2. 用目標 Google 帳號登入一次 app（會自動建立 Auth user）
3. 複製該 user 的 UID

**⚠️ 重要**：Security Rules 要求 `email` 必須符合 `*@talented.com.tw` pattern，且 `active == true`。沒有這個 document 的使用者無法操作任何 Firestore 資料。

---

### Step 4：部署 Frontend（Vercel）

```bash
cd ~/talented-easyorder
./workflow.sh p1
```

**首次部署前需要**：
1. 確認 Vercel 已連結此 repo（如果沒有：`vercel link`）
2. 確認 `.env.local` 存在且內容正確（`./workflow.sh d3` 會自動建立）
3. Vercel 環境變數設定（在 Vercel Dashboard > Project Settings > Environment Variables）：

```
VITE_FIREBASE_API_KEY=<your-firebase-api-key>
VITE_FIREBASE_AUTH_DOMAIN=gen-lang-client-0613258198.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=gen-lang-client-0613258198
VITE_FIREBASE_APP_ID=1:704294644197:web:3c2d159fe167478d47e70c
VITE_FIREBASE_MESSAGING_SENDER_ID=704294644197
VITE_FIREBASE_STORAGE_BUCKET=gen-lang-client-0613258198.firebasestorage.app
VITE_FIREBASE_USE_EMULATOR=false
```

**注意**：這些是 payroll 的 prod Firebase config（web API key 是公開資訊，安全由 Security Rules 保障）。

---

### Step 5：驗證部署

1. **打開 Vercel 部署的 URL**
2. **Google 登入**：用 `@talented.com.tw` 帳號
3. **確認 operator 權限**：登入後應該看到 POS 主畫面（不是 "無權限" 錯誤）
4. **基本功能測試**：
   - 建立一個學生
   - 執行一筆交易（order）
   - 確認 balance 更新
   - 開啟 daily cash session
   - 結帳（drawer settlement）

---

## 快速部署（一鍵全套，跳過 Step 3）

如果 operators collection 已建立，可以用：

```bash
cd ~/talented-easyorder
./workflow.sh p4    # = p1 + p2 + p3
```

或含測試的完整流程：

```bash
./workflow.sh p5    # = tests + p1 + p2 + p3
```

---

## Rollback 計畫

| 問題 | 解法 |
|------|------|
| Rules 部署後 payroll 壞了 | 從 payroll 側重新部署：`cd ~/talented-payroll && firebase deploy --only firestore:rules --project gen-lang-client-0613258198`（注意：這會蓋掉 easyorder rules） |
| Vercel 部署有問題 | Vercel Dashboard > Deployments > 選擇上一個正常版本 > Promote to Production |
| Index 有問題 | Firebase Console > Firestore > Indexes > 手動刪除有問題的 index |

---

## 待辦：payroll workflow.sh 修改

在 easyorder 正式部署 rules 之後，payroll 的 workflow.sh 也需要修改：

**影響範圍**：
- `deploy_prod_rules()` (p3)：加入 merge easyorder rules 的邏輯
- `deploy_prod_full()` (p5)：同上

**不需修改**：
- `deploy_dev_rules()` (d4)：DEV project (`talented-payroll-dev`) 不共用

**修改方式**：加入與 easyorder workflow.sh 相同的 `merge_firestore_rules()` 函數，但方向相反（以 payroll 為主，合併 easyorder）。

---

## 附錄：Firebase Project 資訊

| 項目 | 值 |
|------|-----|
| Project ID | `gen-lang-client-0613258198` |
| Firebase Console | https://console.firebase.google.com/project/gen-lang-client-0613258198 |
| Auth domain | `gen-lang-client-0613258198.firebaseapp.com` |
| Firestore location | (查看 Console > Project Settings) |
| Firebase user | `cheerc@gmail.com` |
| gcloud user | `cheerc@talented.com.tw` |

## 附錄：EasyOrder Firestore Collections

| Collection | 用途 | 與 Payroll 衝突？ |
|-----------|------|-------------------|
| `operators` | 操作員權限控制 | ❌ Payroll 用 `roles` |
| `students` | 學生名冊 + balance | ❌ Payroll 用 `staff_records` 等 |
| `transactions` | 交易紀錄 | ❌ Payroll 無此 collection |
| `daily_settlements` | 日結算 | ❌ Payroll 無此 collection |
| `daily_settlements/{date}/close_attempts` | 結帳嘗試 | ❌ |
| `daily_settlements/{date}/cash_adjustments` | 現金調整 | ❌ |
