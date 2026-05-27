# 「最近 20 筆」極簡化 + 收支統一移至今日帳 (修訂版)

> **狀態**：待核准  
> **日期**：2026-05-27  
> **前置**：2026-05-25-order-display-simplification-payment-offset.md（取代）

---

## 背景與現況問題

根據最新需求，我們需要將右側側邊欄「最近 20 筆」極簡化：
1. **此區域只顯示訂便當與餘額**。
2. **只繳費沒訂便當** 的行，以及 **櫃台收支**，不應該出現在這個地方，因為這些明細已經全部移動到「今日帳」報表了。
3. 顯示格式必須修改為：
   - `訂 1份 餘額 −90` 🔴 (紅字)
   - `訂 2份 餘額 300` 🟢 (綠字)

---

## 方案設計

### 1. `RecentStrip` 顯示過濾與格式
- **過濾條件**：在 `RecentStrip` 中，我們僅保留 `type === 'order'` 的交易紀錄。
- **顯示格式**：
  - 類型徽章：顯示 `訂`。
  - 金額與份數：
    - `recent-amt-lbl` 顯示 `{r.orderCount}份`。
    - `recent-amt-val` 顯示 `餘額 {r.displayBalance < 0 ? '−' : ''}{fmt(r.displayBalance)}` (負數使用 typographic minus U+2212 `−`)。
  - 顏色：
    - 當 `displayBalance < 0` 時，`.recent-amt` 加上 `.neg` 類別 (紅字)。
    - 當 `displayBalance >= 0` 時，`.recent-amt` 加上 `.pos` 類別 (綠字)。

### 2. 今日帳與 CSV 匯出相容性
為了不破壞「今日帳」（Report Tab）中合併模式下的交易明細與 CSV 匯出功能，`mergeLedgerTransactions` 需要同時保留舊欄位和新欄位：
- **新增欄位**：
  - `orderCount`：今日訂便當數量。
  - `displayBalance`：當日最新帳戶餘額。
- **保留舊欄位**：
  - `depositAmount`：儲值金額（供今日帳 `(儲 +$xx)` 顯示與 CSV 匯出）。
  - `unpaidAmount`：待繳費金額（供今日帳 `待繳費 $xx` 顯示與 CSV 匯出）。

---

## Edge Case 驗收標準 (RecentStrip)

| 情境 | 顯示結果 | 顏色 | 說明 |
|------|---------|------|------|
| 訂便當 90，沒付錢（餘額 −90） | `訂 1份 餘額 −90` | 🔴 紅色 | ✅ |
| 訂便當 90，付 50（餘額 −40） | `訂 1份 餘額 −40` | 🔴 紅色 | ✅ 繳費列被合併吸收 |
| 訂便當 90，付 90（餘額 0） | `訂 1份 餘額 0` | 🟢 綠色 | ✅ 餘額為 0 顯示綠色 |
| 訂便當 90，付 100（餘額 10） | `訂 1份 餘額 10` | 🟢 綠色 | ✅ 餘額大於 0 |
| 訂便當 90×2，付 200（餘額 20） | `訂 2份 餘額 20` | 🟢 綠色 | ✅ 份數合併為 2份 |
| 先儲值 200，再訂便當 90（餘額 110） | `訂 1份 餘額 110` | 🟢 綠色 | ✅ |
| **只繳費 500，沒訂便當** | **不顯示** | - | ✅ 已移動到今日帳細目，不在側邊欄顯示 |
| **櫃台收入 100 / 櫃台支出 50** | **不顯示** | - | ✅ 已移動到今日帳，不在側邊欄顯示 |

---

## 預期異動與實作內容

### 1. 交易合併邏輯 (Core Data Layer)
**檔案**：`frontend/src/domain/ledger.ts`

- 更新 `MergedTransaction` 介面：
  ```typescript
  export interface MergedTransaction extends LedgerTransaction {
    depositAmount: number;
    unpaidAmount: number;
    orderCount: number;      // 新增：今日訂便當數量
    displayBalance: number;  // 新增：帳戶餘額（= 該學生當日最新 afterBalance）
  }
  ```
- 更新 `mergeLedgerTransactions`：
  - 在合併學生交易分群時，計算學生的 `orderCount` (當日訂單筆數)。
  - `displayBalance` 設定為該學生當日最後一筆交易的 `afterBalance`。
  - 當日所有 orders 和 payments 合併：
    - 如果有 orders，合併為一筆 `type = 'order'` 交易。
    - 該交易的 `orderCount` = 當日訂單數量。
    - 該交易的 `displayBalance` = 當日最後一筆交易的 `afterBalance`。
    - 保留 `depositAmount` 和 `unpaidAmount` 以相容今日帳與 CSV。
    - 當日 payments 交易被合併吸收。
    - 如果無 orders，則保留 payments 作為獨立行（但其 `orderCount` 為 0），以供今日帳顯示。

### 2. RecentStrip 元件更新
**檔案**：`frontend/src/components/pos-components.tsx`

- 更新 `RecentStrip` 渲染：
  - 僅過濾並顯示 `type === 'order'` 的交易。
  - 將金額欄位改為以下結構：
    ```typescript
    const isNeg = r.displayBalance < 0;
    // ...
    <span className={'recent-amt mono ' + (isNeg ? 'neg' : 'pos')}>
      <span className="recent-amt-lbl">{r.orderCount}份</span>
      <span className="recent-amt-val">餘額 {isNeg ? '−' : ''}{fmt(r.displayBalance)}</span>
    </span>
    ```

### 3. 單元測試更新
**檔案**：
- `frontend/src/components/__tests__/pos-components.test.tsx`
- `frontend/src/domain/__tests__/ledger.test.ts`
- 更新與新增測試案例以匹配新的顯示邏輯。

---

## 驗證計畫

### 自動化測試
```bash
cd frontend && npm run test
cd frontend && npx tsc --noEmit
```

### 手動驗證流程
1. 訂便當不付錢 → 側邊欄顯示 `訂 1份 餘額 −90` 🔴
2. 訂便當付 50 → 側邊欄顯示 `訂 1份 餘額 −40` 🔴
3. 訂便當付 90 → 側邊欄顯示 `訂 1份 餘額 0` 🟢
4. 訂便當付 100 → 側邊欄顯示 `訂 1份 餘額 10` 🟢
5. 只繳費 500 → 側邊欄無 any 新顯示，點進「今日帳」可在該生明細中看到 `繳費 +$500`
6. 新增櫃台支出 200 → 側邊欄無新顯示，點進「今日帳」可在櫃台收支明細中看到 `支出 −$200`
