# 調整學生編號選擇下拉選單的滑鼠干擾行為 - 實作計畫

本計畫旨在解決當使用者透過鍵盤操作（如上下鍵、Enter 鍵）進行學生搜尋下拉選單時，滑鼠的 hover 事件（`mouseenter`）會干擾選取狀態的問題。我們將提供 `disableHoverSelection` 控制設定，預設為 `true`，以避免 hover 變更當前 active index，同時保留滑鼠點擊選取與頁面其他區域的滑鼠點擊功能。

## 背景與目標
目前系統在使用者輸入學生編號時，會即時顯示一個下拉列表。列表項目在滑鼠移動至該項目時會自動切換為「已選取」狀態。此行為在純鍵盤操作（例如使用上下鍵或 Enter 鍵）選擇學生時，會被滑鼠的 hover 事件干擾，導致選取結果不符合預期。

### 目標
- 讓鍵盤輸入與鍵盤選擇（上下鍵、Enter）成為唯一影響下拉選單選取的方式。
- 保留使用者在頁面其他區域（非下拉選單）使用滑鼠點擊的功能。
- 在不影響現有 UI/UX 的前提下，避免滑鼠 hover 事件對下拉選單產生選取變更。

---

## 預期異動與實作內容

### 1. 下拉選單元件調整 (SearchBox Component)
- **檔案**：`frontend/src/components/pos-components.tsx`
- **修改內容**：
  - 在 `SearchBoxProps` 介面中新增可選屬性：
    ```typescript
    disableHoverSelection?: boolean;
    ```
  - 在 `SearchBox` 元件解構賦值中接收 `disableHoverSelection`，預設為 `true`。
  - 修改 `onMouseEnter` 監聽器，當 `disableHoverSelection` 為 `true` 時，阻止呼叫 `onHover(i)`：
    ```typescript
    onMouseEnter={() => {
      if (!disableHoverSelection) {
        onHover(i);
      }
    }}
    ```

---

### 2. 今日設定頁面配置 (Admin screen)
- **檔案**：`frontend/src/components/screens.tsx`
- **修改內容**：
  - 修改 `AdminScreenProps` 介面中的 `tweaks` 屬性定義，使其包含 `disableHoverSelection: boolean`。
  - 在 `AdminScreen` 的「顯示設定」區塊中新增「停用滑鼠 hover 選取」的下拉選單選項：
    ```tsx
    <div className="adm-row">
      <label>停用滑鼠 hover 選取</label>
      <select 
        className="adm-input" 
        value={tweaks.disableHoverSelection ? 'true' : 'false'} 
        onChange={e => setTweak('disableHoverSelection', e.target.value)}
      >
        <option value="true">停用 (預設)</option>
        <option value="false">啟用 (傳統行為)</option>
      </select>
    </div>
    ```

---

### 3. 主頁面 State 與屬性傳遞 (App Component)
- **檔案**：`frontend/src/App.tsx`
- **修改內容**：
  - 調整 `tweaks` state 的初始值，加入 `disableHoverSelection: true`：
    ```typescript
    const [tweaks, setTweaks] = useState({ theme: 'warm', fontSize: 'lg', disableHoverSelection: true });
    ```
  - 調整 `setTweak` 函式，以型別安全的方式處理 `disableHoverSelection`：
    ```typescript
    const setTweak = (k: string, v: string) => setTweaks(prev => {
      if (k === 'disableHoverSelection') {
        return { ...prev, disableHoverSelection: v === 'true' };
      }
      return { ...prev, [k]: v };
    });
    ```
  - 在渲染 `SearchBox` 元件時，將 `disableHoverSelection={tweaks.disableHoverSelection}` 傳入。

---

### 4. 單元測試撰寫 (Unit Tests)
- **檔案**：`frontend/src/components/__tests__/pos-components.test.tsx`
- **修改內容**：
  - 新增 `SearchBox` 的單元測試描述區塊（`describe('SearchBox')`）。
  - 測試在 `disableHoverSelection` 為 `true` 時，滑鼠移入選項時不會觸發 `onHover` 變更。
  - 測試在 `disableHoverSelection` 為 `false` 時，滑鼠移入選項時會正常觸發 `onHover` 變更。

---

## 驗收標準 (Acceptance Criteria)
1. **鍵盤僅操作時選取正確**：使用上下鍵切換焦點與 Enter 鍵確認選取正常。
2. **滑鼠 hover 不改變選取**：在列表開啟期間，將滑鼠移動至列表項目上，選取項目不變。
3. **滑鼠點擊仍能選取**：直接點擊列表項目時，選取項目更新且列表關閉。
4. **設定檔切換生效**：在「今日設定」中切換為「啟用」，下拉選單恢復 hover 選取功能。
5. **相容性與回歸**：其他元件（非學生編號搜尋）不受影響，鍵盤焦點管理與螢幕閱讀器正常工作。

## 測試範圍與指令
- 測試執行指令：
  ```bash
  npm run test -- run src/components/__tests__/pos-components.test.tsx
  ```
