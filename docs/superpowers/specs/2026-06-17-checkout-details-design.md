# Design Spec: 訂便當結帳明細介面優化

## 1. 目的與背景
目前系統在「訂便當」模式下，左側的結帳明細僅顯示單行「當日便當 -$90」，未能清晰告知使用者目前餘額、此次繳費變動及最終預計餘額。相比之下，「繳費」模式則擁有完整的 3 行明細。
為了提升交易透明度並提供更好的 UX，此設計將「訂便當」模式下的明細擴展為與繳費風格一致的 4 行完整結構。

## 2. 需求描述
在訂便當 (`mode === 'order'`) 時，結帳明細區塊必須展示以下 4 行：
1. **目前帳戶餘額**：顯示當下帳戶餘額（`student.currentBalance`）。
2. **今日便當 (便當名稱)**：顯示本次便當扣減金額（`-effectiveMealPrice`）。
3. **此次繳費金額**：顯示實收金額（`+parsedPayAmount`）。
4. **預計結帳後餘額**：顯示 `目前帳戶餘額 - 今日便當金額 + 此次繳費金額`。

## 3. 架構設計與程式碼變更

### 3.1 核心邏輯變更：`CustomerCard.tsx`
檔案位置：[frontend/src/components/pos/CustomerCard.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos/CustomerCard.tsx)

1. **更新 `projectedBalance` 的計算**：
   在 `mode === 'order'` 時，結帳後餘額必須同時扣除便當價格：
   ```typescript
   const projectedBalance = mode === 'order'
     ? student.currentBalance - effectiveMealPrice + parsedPayAmount
     : student.currentBalance + parsedPayAmount;
   ```

2. **優化 `mode === 'order'` 下的 JSX 渲染**：
   使用與 `mode === 'payment'` 相同規格的 `.bill-item.no-border` 及 `.bill-divider` 等樣式，替換原有單行便當的顯示：
   ```tsx
   {mode === 'order' && (
     <>
       <div className="bill-item no-border">
         <span className="bill-label">目前帳戶餘額</span>
         <span className={`bill-val${student.currentBalance < 0 ? ' neg' : ''}`}>
           {student.currentBalance < 0 ? '−' : ''}${fmt(student.currentBalance)}
         </span>
       </div>
       <div className="bill-item no-border">
         <span className="bill-label">今日便當 ({priceOverrideLabel || todayMenu.itemName})</span>
         <span className="bill-val neg">−${fmt(effectiveMealPrice)}</span>
       </div>
       <div className="bill-item no-border">
         <span className="bill-label">此次繳費金額</span>
         <span className="bill-val pos">
           +${fmt(parsedPayAmount)}
         </span>
       </div>
       <div className="bill-divider" />
       <div className="bill-item bill-total">
         <span className="bill-label">預計結帳後餘額</span>
         <span className={`bill-val${projectedBalance < 0 ? ' neg' : ''}`}>
           {projectedBalance < 0 ? '−' : ''}${fmt(projectedBalance)}
         </span>
       </div>
     </>
   )}
   ```

### 3.2 測試修正
檔案位置：[frontend/src/components/pos/__tests__/CustomerCard.test.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos/__tests__/CustomerCard.test.tsx)
- 由於明細行數變更，需更新對應的單元測試，確保 `mode === 'order'` 下的明細項目數量與內文斷言與新設計相符。

## 4. 驗證計畫
1. **單元測試**：執行 `npm run test:unit`（或 `workflow.sh t4`）確保全部測試通過。
2. **手動驗證**：在前端畫面上切換至「訂便當」模式，隨機輸入本次繳費金額，核對這 4 行明細的數值與正負號是否均正確無誤。

## Related
- none

🤖 opened by: lead (eo-team-lead)
