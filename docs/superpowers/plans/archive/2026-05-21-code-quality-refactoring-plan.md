---
required_reads:
  - docs/superpowers/reviews/2026-05-21-code-quality-review.md
  - frontend/src/store/posStore.ts
  - frontend/src/domain/ledger.ts
  - frontend/src/App.tsx
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/domain/posTransaction.ts
  - frontend/src/components/screens.tsx
  - frontend/src/components/pos-components.tsx
  - frontend/src/components/tweaks-panel.tsx
  - frontend/src/components/ui/NumberField.tsx
  - frontend/src/storage/posStateValidator.ts
complexity: complex+
---

# talented-easyorder 程式碼品質與重構執行計畫書
**日期**：2026-05-21  
**計畫書作者**：Antigravity AI  

本文件針對 Commit `35a77cafe45da9a9b5dc066cc0c21ec065f13fef` 中所附之程式碼審查報告（Code Review Report）進行詳細分析，確認報告所言皆屬實。為使開發人員能高效率、低風險地完成重構，本計畫書詳細規劃了各問題點的重構步驟、具體程式碼變更範例及驗證方案。

---

## 目錄
1. [🔴 關鍵問題 1：冗餘且低效的餘額重算邏輯](#1-冗餘且低效的餘額重算邏輯)
2. [🔴 關鍵問題 2：Infrastructure 邏輯滲透核心 Store](#2-infrastructure-邏輯滲透核心-store)
3. [🟡 主要問題 1：God Component — App.tsx](#3-god-component--apptsx)
4. [🟡 主要問題 2：重複的交易屬性推導](#4-重複的交易屬性推導)
5. [🟡 主要問題 3：使用 window.prompt 進行資料編輯](#5-使用-windowprompt-進行資料編輯)
6. [🟢 次要問題 1：組件庫過於巨大且職責混雜](#6-次要問題-1組件庫過於巨大且職責混雜)
7. [🟢 次要問題 2：殘留的 Tweaks 實驗性代碼](#7-次要問題-2殘留的-tweaks-實驗性代碼)
8. [🧪 驗證計畫（Verification Plan）](#8-驗證計畫)

---

## 🔴 關鍵問題

### 1. 冗餘且低效的餘額重算邏輯

#### 【現況說明】
在 [posStore.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/posStore.ts) 的 `deleteOrderWithRefundCheck` 中，當移除某一筆交易時，自行實作了一套 O(N log N) 的學生餘額重算邏輯。這套邏輯與 [ledger.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/ledger.ts) 的 `recalculateStudentBalances` 幾乎完全重疊，且手寫版漏掉了對剩餘交易之 `afterBalance` 欄位的更新。

在最新 Commit `de3b57c` 中，報表表格（[LedgerGroupedTable.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/report/LedgerGroupedTable.tsx)）已新增了顯示餘額歷史的交易明細欄位（顯示 `t.afterBalance`）。因此，原手寫版未更新 `afterBalance` 將會直接在報表 UI 上呈現錯誤的累計餘額，此問題之修正變得更為迫切。

#### 【重構步驟】
1. **調整匯入**：在 [posStore.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/posStore.ts) 頂部匯入 `recalculateStudentBalances`：
   ```typescript
   import { recalculateStudentBalances } from '../domain/ledger';
   ```
2. **重構 `deleteOrderWithRefundCheck`**：
   將手動的餘額映射與排序重算區塊（原 L324-348），替換為呼叫領域函數，並保留「櫃台（CASHIER_SENTINEL）」的非學員收支。
   
   **修改前代碼：**
   ```typescript
   // Recalculate all student balances by filtering out deleted tx and recomputing
   const remainingTx = state.transactions.filter(t => t.transactionId !== id);
   const balanceMap = new Map<string, number>();
   for (const s of state.students) {
     balanceMap.set(s.studentId, 0);
   }

   const sorted = [...remainingTx]
     .filter(t => t.studentId !== CASHIER_SENTINEL)
     .sort((a, b) => {
       if (a.businessDate !== b.businessDate) return a.businessDate.localeCompare(b.businessDate);
       if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
       return a.transactionId.localeCompare(b.transactionId);
     });

   for (const t of sorted) {
     const prev = balanceMap.get(t.studentId) ?? 0;
     const newBal = Math.round(prev + t.amount);
     balanceMap.set(t.studentId, newBal);
   }

   const newStudents = state.students.map(s => ({
     ...s,
     currentBalance: balanceMap.get(s.studentId) ?? s.currentBalance,
   }));

   const newTransactions = state.transactions.filter(t => t.transactionId !== id);
   ```

   **修改後代碼：**
   ```typescript
   const remainingTx = state.transactions.filter(t => t.transactionId !== id);

   // 1. 呼叫統一的領域層重算函數
   const { students: newStudents, transactions: newStudentTx } = recalculateStudentBalances(
     state.students,
     remainingTx
   );

   // 2. 將重算後的學生交易，與原有的櫃台收支交易（CASHIER_SENTINEL）重新合併
   const cashierTx = remainingTx.filter(t => t.studentId === CASHIER_SENTINEL);
   
   // 3. 確保 store 中的 transactions 依時間降序（newest first）排列
   const newTransactions = [...newStudentTx, ...cashierTx].sort(
     (a, b) => b.createdAt.localeCompare(a.createdAt)
   );
   ```

---

### 2. Infrastructure 邏輯滲透核心 Store

#### 【現況說明】
[posStore.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/posStore.ts) 的 `migrate` 函數（L544-616）內聯了大量資料格式與 schema 的對應邏輯（例如將舊版的 `{id, name, balance}` 學員結構轉為 `StudentAccount`，對應舊版供應商及菜單等）。這使 Store 的職責混雜了資料持久化層的適配工作。

#### 【重構步驟】
1. **建立新模組**：新建 [src/storage/migration.ts](file:///Users/cheerc/talented-easyorder/frontend/src/storage/migration.ts)。
2. **移轉邏輯**：將原 `migrate` 邏輯完整抽離至此新檔案。
3. **Store 呼叫**：在 Store 中直接引用該函數。

**新建 [src/storage/migration.ts](file:///Users/cheerc/talented-easyorder/frontend/src/storage/migration.ts) 範例：**
```typescript
import type { PosState } from '../store/posStore';
import type { Vendor } from '../domain/menu';

export function migratePersistedState(persistedState: unknown, version: number): PosState {
  const state = persistedState as Record<string, unknown>;
  if (!state) return state as unknown as PosState;

  // v2: 補足稽核狀態欄位
  if (!('auditEvents' in state)) state.auditEvents = [];
  if (!('dailySettlements' in state)) state.dailySettlements = [];
  if (!('businessDateStatuses' in state)) state.businessDateStatuses = {};

  // 標準化舊型別學員 {id, name, balance} → StudentAccount
  const rawStudents = state.students as Array<Record<string, unknown>> | undefined;
  if (rawStudents && rawStudents.length > 0 && 'id' in rawStudents[0] && !('studentId' in rawStudents[0])) {
    state.students = rawStudents.map((s: Record<string, unknown>) => ({
      studentId: s.id as string,
      displayName: (s.name as string) || '',
      status: 'active',
      currentBalance: (s.balance as number) ?? 0,
      aliases: [],
      faceEnrollmentStatus: 'none',
      createdAt: '2026-01-10T08:00:00Z',
      updatedAt: '2026-01-10T08:00:00Z',
      revision: 1,
    }));
  }

  // 標準化舊型別交易 → LedgerTransaction
  const rawTx = state.transactions as Array<Record<string, unknown>> | undefined;
  if (rawTx && rawTx.length > 0) {
    state.transactions = rawTx.map((t: Record<string, unknown>) => {
      const hasId = 'id' in t && !('transactionId' in t);
      const hasSyncStatus = 'syncStatus' in t;
      return {
        ...t,
        transactionId: hasId ? t.id as string : (t.transactionId as string),
        syncStatus: hasSyncStatus ? t.syncStatus : 'local',
      };
    });
  }

  // 標準化舊型別供應商 → Vendor
  const rawVendors = state.vendors as Array<Record<string, unknown>> | undefined;
  if (rawVendors && rawVendors.length > 0 && 'id' in rawVendors[0] && !('vendorId' in rawVendors[0])) {
    state.vendors = rawVendors.map((v: Record<string, unknown>) => ({
      vendorId: v.id as string,
      name: (v.name as string) || '',
      phone: (v.phone as string) || '',
      note: (v.note as string) || '',
      status: 'active' as const,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      revision: 1,
    }));
  }

  // 標準化舊型別今日菜單 → TodayMenu
  const rawMenu = state.todayMenu as Record<string, unknown> | undefined;
  if (rawMenu && 'date' in rawMenu && !('businessDate' in rawMenu)) {
    const vendorName = (rawMenu.vendor as string) || '';
    const oldVendors = (state.vendors as Vendor[]) || [];
    const matchedVendor = oldVendors.find(v => v.name === vendorName);
    state.todayMenu = {
      businessDate: rawMenu.date as string,
      itemName: (rawMenu.name as string) || '',
      price: (rawMenu.price as number) ?? 0,
      vendorId: matchedVendor?.vendorId || 'v1',
      vendorNameSnapshot: vendorName,
      updatedAt: '2026-05-07T07:00:00Z',
      revision: 1,
    };
  }

  return state as unknown as PosState;
}
```

**在 [posStore.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/posStore.ts) 中引用：**
```typescript
import { migratePersistedState } from '../storage/migration';
// ...
persist(
  (set, get) => ({
    // ...
  }),
  {
    name: 'pos-storage',
    version: 2,
    onRehydrateStorage: () => { /* ...保持呼叫 validatePersistedState 等... */ },
    migrate: migratePersistedState, // 直接引用抽離後的函數
  }
)
```

---

## 🟡 主要問題

### 1. God Component — App.tsx

#### 【現況說明】
[App.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/App.tsx) 超過 660 行，職責過度集中。它混合了分頁選單路由渲染、全域快捷鍵與多層焦點管理、儲存健康監測、閃退交易草稿復原等。

#### 【重構步驟】
1. **抽離鍵盤與焦點管理**：
   將 `App.tsx` 中的 F1-F6 全域切換頁面快捷鍵監聽（L299-320），以及 POS 畫面方向鍵與 Enter/Esc 的焦點管理（L338-395）打包為一個自訂 Hook，例如 `useAppNavigationShortcuts`。
   *特別注意：Commit `de3b57c` 引入了 `searchFocusKey` 狀態以在按下數字鍵時自動聚焦搜尋框。此自訂 Hook 需接收或管理此狀態與對應的 `setSearchFocusKey` 觸發器，以維持該聚焦邏輯的完整性。*
2. **封裝 `MainLayout`**：
   建立一個 Layout 組件，專門負責 `TopBar`、`ConfirmBanner`、`ConfirmDialog`、`TweaksPanel` 等周邊框架的排版，使 `App.tsx` 的 Return 結構能專注於頁面路由的分流。

**抽離後的 `App.tsx` 結構預期：**
```tsx
export default function App() {
  const { tab, setTab, viewDate, setViewDate, ... } = useAppNavigation();

  // 使用自訂 Hook 管理鍵盤行為與焦點狀態
  useAppNavigationShortcuts({ tab, setTab, ... });

  return (
    <MainLayout
      tab={tab}
      setTab={setTab}
      // ...傳入 TopBar 所需狀態與 banner 元件...
    >
      {tab === 'pos' && <PosScreen {...posProps} />}
      {tab === 'report' && <ReportScreen {...reportProps} />}
      {tab === 'admin' && <AdminScreen {...adminProps} />}
      {tab === 'vendors' && <VendorsScreen {...vendorsProps} />}
      {tab === 'history' && <HistoryScreen />}
    </MainLayout>
  );
}
```

---

### 2. 重複的交易屬性推導

#### 【現況說明】
在 [usePosFlow.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/usePosFlow.ts) 中，於 `saveCrashDraft`（草稿儲存）與 `commitTransaction`（正式提交交易）中，針對 `mealPrice`、`paidAmount` 與備註 `note` 的推導邏輯有高達 90% 的重疊。

#### 【重構步驟】
1. **於領域層定義工廠函數**：
   在 [posTransaction.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/posTransaction.ts) 中新增 `deriveTransactionAttributes` 函數，集中處理改價、繳費與支出/收入（Expense）下的金額與備註生成規則。

**在 [posTransaction.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/posTransaction.ts) 中實作：**
```typescript
export interface DerivedTransactionAttrs {
  mealPrice: number;
  paidAmount: number;
  note: string;
}

export function deriveTransactionAttributes(args: {
  mode: PosMode;
  todayMenuPrice: number;
  todayMenuItemName: string;
  priceOverride: number | null;
  priceOverrideLabel: string;
  paidAmountText?: string;
  expenseAmount?: number;
  expenseNote?: string;
  expenseDirection?: 'income' | 'expense';
}): DerivedTransactionAttrs {
  const { mode, todayMenuPrice, todayMenuItemName, priceOverride, priceOverrideLabel } = args;
  
  let mealPrice = 0;
  let paidAmount = 0;
  let note = '';

  const parsedAmount = args.paidAmountText ? parsePaidAmount(args.paidAmountText) : null;
  const paidAmountVal = (parsedAmount && parsedAmount.ok) ? parsedAmount.value : 0;

  if (mode === 'order') {
    mealPrice = priceOverride ?? todayMenuPrice;
    const isOverride = priceOverride !== null;
    const label = priceOverrideLabel.trim() || todayMenuItemName;
    note = isOverride
      ? `單筆改價：${label}`
      : todayMenuItemName + (paidAmountVal > 0 ? ' (已付)' : '');
  } else if (mode === 'payment') {
    mealPrice = 0;
    paidAmount = paidAmountVal;
    note = '現金繳費';
  } else if (mode === 'expense') {
    if (args.expenseDirection === 'income') {
      mealPrice = 0;
      paidAmount = args.expenseAmount ?? 0;
    } else {
      mealPrice = args.expenseAmount ?? 0;
      paidAmount = 0;
    }
    note = args.expenseNote ?? '';
  }

  return { mealPrice, paidAmount, note };
}
```

2. **在 [usePosFlow.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/usePosFlow.ts) 中調用**：
   替換 `saveCrashDraft` 與 `commitTransaction` 內的手動賦值：
   ```typescript
   const attrs = deriveTransactionAttributes({
     mode,
     todayMenuPrice: todayMenu.price,
     todayMenuItemName: todayMenu.itemName,
     priceOverride: args.priceOverride,
     priceOverrideLabel: args.priceOverrideLabel,
     paidAmountText,
     expenseAmount,
     expenseNote,
     expenseDirection,
   });
   // 使用 attrs.mealPrice, attrs.paidAmount, attrs.note
   ```

---

### 3. 使用 window.prompt 進行資料編輯

#### 【現況說明】
[screens.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/screens.tsx) 的 `ReportScreen` 中（L120-131）使用連續三個 `window.prompt` 讓櫃台編輯交易資訊。這沒有類型驗證、不能防止使用者輸入無意義字串，且使用者體驗不佳。

#### 【重構步驟】
1. **使用現有 UI 元件封裝 `EditTransactionModal`**：
   在 `components` 目錄下利用既有的 `Modal`、`NumberField` 與 `TextField` 組件，建立一個受控的編輯視窗。
   *特別注意：Commit `de3b57c` 引入了統一的限制輸入元件 `NumericInput`（且已同步將 `NumberField` 底層改為 `NumericInput`），編輯視窗中的金額欄位應優先使用此組件，以自動繼承滾輪禁用、非數字字元限制及退格鍵行為等優點。*

**`EditTransactionModal` 實作範例：**
```tsx
import React, { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { NumberField } from './ui/NumberField';
import { TextField } from './ui/TextField';
import { Button } from './ui/Button';
import type { LedgerTransaction } from '../domain/ledger';

interface EditTransactionModalProps {
  open: boolean;
  transaction: LedgerTransaction | null;
  onClose: () => void;
  onSave: (updates: { mealPrice: number; paidAmount: number; note: string }) => void;
}

export const EditTransactionModal = React.memo(function EditTransactionModal({
  open,
  transaction,
  onClose,
  onSave,
}: EditTransactionModalProps) {
  const [mealPrice, setMealPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (transaction) {
      setMealPrice(transaction.mealPrice);
      setPaidAmount(transaction.paidAmount);
      setNote(transaction.note || '');
      setErrors({});
    }
  }, [transaction]);

  if (!transaction) return null;

  const handleSave = () => {
    const nextErrors: Record<string, string> = {};
    if (!Number.isInteger(mealPrice) || mealPrice < 0) {
      nextErrors.mealPrice = '金額必須為正整數';
    }
    if (!Number.isInteger(paidAmount) || paidAmount < 0) {
      nextErrors.paidAmount = '實收金額必須為正整數';
    }
    
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    onSave({ mealPrice, paidAmount, note });
  };

  return (
    <Modal open={open} title="編輯交易項目" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <NumberField
          label="支出金額 (mealPrice)"
          value={mealPrice}
          onChange={setMealPrice}
          error={errors.mealPrice}
          suffix="元"
        />
        <NumberField
          label="實收金額 (paidAmount)"
          value={paidAmount}
          onChange={setPaidAmount}
          error={errors.paidAmount}
          suffix="元"
        />
        <TextField
          label="備註"
          value={note}
          onChange={setNote}
          placeholder="例如：單筆改價或備註說明"
        />
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave}>儲存變更</Button>
        </div>
      </div>
    </Modal>
  );
});
```

2. **在 `ReportScreen` 中整合 Modal**：
   - 引入 `EditTransactionModal`。
   - 新增狀態 `const [editingTx, setEditingTx] = useState<LedgerTransaction | null>(null);`。
   - 將 `handleEditClick` 調整為 `setEditingTx(t)`。
   - 在 `ReportScreen` 的 JSX 最下方渲染該 Modal：
     ```tsx
     <EditTransactionModal
       open={editingTx !== null}
       transaction={editingTx}
       onClose={() => setEditingTx(null)}
       onSave={(updates) => {
         usePosStore.getState().editTransaction(editingTx!.transactionId, updates);
         setEditingTx(null);
       }}
     />
     ```

---

## 🟢 次要問題

### 1. 組件庫過於巨大且職責混雜

#### 【現況說明】
[pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx) 檔案大小達 32KB，將所有櫃台核心組件（導航欄、搜尋欄、卡片、按鈕、交易面板）全部擠在一個檔案，且存在許多行內樣式，增加了閱讀與後續維護的困難度。

#### 【重構步驟】
1. **建立原子化目錄結構**：
   在 `src/components/` 下建立 `pos/` 資料夾，並將組件拆分為單一檔案：
   - `src/components/pos/TopBar.tsx` (包含 `MidnightBanner`)
   - `src/components/pos/SearchBox.tsx`
   - `src/components/pos/CustomerCard.tsx`
   - `src/components/pos/ActionBar.tsx`
   - `src/components/pos/RecentStrip.tsx`
   - `src/components/pos/ExpensePanel.tsx`
2. **清理行內樣式**：
   將寫在 JSX 中的 `style={{ display: 'flex', gap: '8px' }}` 等樣式，移至對應的 CSS 檔案或專案全域 CSS 變數中，保持 UI 的結構乾淨。

---

### 2. 殘留的 Tweaks 實驗性代碼

#### 【現況說明】
[tweaks-panel.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/tweaks-panel.tsx) 含有大量實驗階段的滑桿、調色盤、拖曳元件等程式碼，且內建了 iframe `postMessage` 雙向通訊監聽，增加了系統複雜性。

#### 【重構步驟】
1. **將實用設定收攏至 AdminScreen**：
   目前「主題切換（theme）」與「字體大小（fontSize）」是唯一實際在 `App.tsx` 中使用的 Tweaks 設定。
   建議在 [screens.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/screens.tsx) 的 `AdminScreen`（今日設定）中，直接加入這兩個選項作為系統基本設定。
2. **刪除 `tweaks-panel.tsx` 檔案**：
   確認功能遷移完畢後，直接刪除該檔案，並將 `App.tsx` 中對它的 Import 及渲染移除，釋放 bundle size。

---

## 🧪 驗證計畫

為確保上述重構不會引起回歸錯誤（Regressions），應執行以下驗證步驟：

### 1. 自動化測試
執行專案內的 Vitest 單元測試以確保商業邏輯完全正確：
```bash
npm run test
```
*註：重構 migrate 邏輯後，請確認 `ledgerStore.test.ts` 中的 `hydration migration` 測試仍能順利通過。*

### 2. 手動驗證流程
- **驗證交易刪除**：在櫃台隨意新增交易，至報表頁點選「刪除」，確認對應學員之餘額重算正確，且交易歷史明細中的「餘額 (afterBalance)」亦同步更新。
- **驗證交易編輯**：在報表頁點選「編輯」某筆訂單，確認彈出新版的 `EditTransactionModal`。修改金額與備註後送出，驗證學員餘額與稽核軌跡（Audit Event）皆能正確寫入。
- **驗證頁面切換與快捷鍵**：按下鍵盤 `F1` ~ `F5`，確認仍能流暢切換櫃台、報表等頁面；並確認數字鍵仍能在 Idle 狀態下自動聚焦至搜尋框。
