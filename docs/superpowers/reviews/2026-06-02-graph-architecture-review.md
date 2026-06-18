# 架構審查與優化建議 (基於 Knowledge Graph 分析)

> 建立日期: 2026-06-02
> 資料來源: Graphify 依賴關係分析 (619 個核心節點)

本文件基於對專案 Knowledge Graph 的深度掃描，統整出目前系統的架構現況、潛在技術債，並針對未來的程式碼品質、安全性及擴充性提出具體建議。

---

## 1. 核心骨幹保護 (The God Nodes)

Graph 分析顯示，系統高度依賴以下幾個核心「上帝節點」。這些節點是系統的命脈，任何改動都會產生巨大的擴散效應 (Blast Radius)。

### 1.1 `LedgerTransaction` (高達 31 條依賴連線)
*   **現況**：作為系統中最大的橋樑，連接著 UI、核心領域邏輯與關帳/歷史紀錄。
*   **維護與優化建議**：
    *   **嚴格的向後相容性**：`LedgerTransaction` 的 Type 或介面若需修改，必須極度謹慎。建議實作嚴謹的 Type Guards (如現有的 `posStateValidator`) 來確保在升級過程中的資料完整性。
    *   **DTO (Data Transfer Object) 隔離**：目前發現如 `EditTransactionModalProps` 等 UI 元件直接依賴此核心 Entity。未來若 UI 需求變得複雜，建議引入 View Models (例如 `LedgerPrintViewModel` 這種模式)，避免 UI 邏輯污染核心 Domain Model。

### 1.2 `StudentAccount` & `TodayMenu` (22 與 20 條連線)
*   **現況**：這兩個是僅次於交易的核心實體，證明系統的領域邊界 (Domain Boundaries) 劃分得很健康，高度圍繞學生與菜單運作。
*   **未來擴充建議**：
    *   保持這兩個實體的純粹性，避免將 Firebase 的特定邏輯（如 DocumentReference）直接混入這兩個 Domain Model 中。應持續透過 Repository Pattern (如 `studentRepository`) 來進行資料存取。

---

## 2. 狀態管理與模組內聚度 (State & Cohesion)

### 2.1 `usePosStore` / `PosState` 膨脹警訊
*   **現況**：作為全局狀態管理，連線數極高 (18~22)。這意味著大量 UI 元件直接與 Global Store 耦合。
*   **優化方向 (Code Quality & Maintainability)**：
    *   **Selectors 重構**：持續鼓勵使用 Derived State (如已經存在的 `useLedgerReport`, `useCashClose`) 來取代直接存取 `usePosStore`。這能大幅減少不必要的 Re-renders，並讓元件與 Store 解耦。
    *   **Store 拆分評估**：如果未來加入更多模組（例如進銷存、員工排班），目前的單一 `PosStore` 會成為瓶頸。應預先規劃如何將狀態切分為獨立的 Slices (例如 Auth Slice, Transaction Slice, UI State Slice)。

### 2.2 核心領域邏輯的內聚度偏低 (Cohesion Score: 0.07)
*   **現況**：分析指出，負責「帳本寫入 (`createLedgerTransaction`)」與「每日關帳 (`DailySettlement`)」的邏輯被歸類在同一個大模組中，但內聚度不高。
*   **優化與重構建議 (Architecture)**：
    *   **分離職責**：日常的 POS 交易行為 (Transaction Recording) 與營業結束的關帳行為 (Cash Close / Settlement) 雖然相關，但變更頻率與安全層級不同。
    *   建議未來在架構上，明確劃分 **Transaction Domain** (專注於高併發的訂單寫入) 與 **Settlement Domain** (專注於資料核對、總結與鎖定)。這將有助於簡化單一模組的複雜度，降低改壞核心交易邏輯的風險。

---

## 3. 安全性與基礎設施 (Security & Infrastructure)

### 3.1 跨模組依賴：`appendErrorLog()`
*   **現況**：此節點具有極高的中介中心度 (Betweenness Centrality)，連接著 UI、Domain、Firebase 等超過 5 個不同的子系統。
*   **安全性與優化建議**：
    *   **PII 守門員**：因為錯誤日誌無所不在，`appendErrorLog` 成為了防止個人隱私資訊 (PII - 如學生全名、餘額) 外洩到日誌系統的最重要防線。必須確保其內部的 `sanitizeMessage` 或 `sanitizeContext` 邏輯足夠強健，並對此加入嚴密的 Unit Tests。
    *   **效能考量**：確保頻繁的 Error Logging 不會阻塞 Main Thread 或導致記憶體洩漏 (Memory Leak)，目前的 `CONTEXT_ALLOW_LIST` 設計是一個好的開始。

### 3.2 基礎設施依賴
*   **現況**：Graph 捕捉到了 `workflow.sh` 與部署腳本的高度關聯。
*   **未來發展建議**：
    *   這顯示團隊依賴 Shell Script 進行自動化。隨著專案擴大，可考慮將這類驗證邏輯逐步整合進真正的 CI/CD Pipeline (如目前的 `.github/workflows/ci.yml`)，以減少本地環境差異帶來的部署風險。

---

## 總結 (Executive Summary)

目前的系統架構 (Cleaned Graph) 展現了明確的邊界劃分，核心業務邏輯（如 `LedgerTransaction`）有被適當地抽象出來。未來的技術投資應著重於：
1. **鞏固防線**：為 `LedgerTransaction` 和 `errorLogger` 建立最嚴格的測試與審查機制。
2. **解耦狀態**：將 UI 與 `usePosStore` 透過 Derived Hooks 隔離開來，為未來的模組拆分鋪路。
3. **職責分離**：評估將「日常交易」與「關帳結算」在程式碼結構上進一步獨立，以提升長期的可維護性。
