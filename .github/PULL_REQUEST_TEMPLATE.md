<!-- 用中文填寫；不寫 AI 模型名稱、真實姓名、餘額或其他個資。不適用的欄位寫 N/A，不要刪掉。 -->

## 變更內容
<!-- 改了什麼；列出主要檔案或行為 -->

## 原因
<!-- 對應 issue（Closes #N）、spec 章節、plan phase 或使用者授權 -->

## 做法與範圍
<!-- 實作方式；明列沒改的部分（Rules、command kind、備份／replay 格式、讀取量）與偏離 plan 之處 -->
- RED commit：
- GREEN commit：
- docs-check：arch=? adr=? area=?

## 驗證
<!-- 精確命令、exit／測試數；Emulator 一律 demo-easyorder。docs-only PR 只寫 diff／連結／路徑核對，不宣稱跑過 app 測試 -->
- Base SHA：
- Head SHA：
- 已執行：
- 未執行／交給 CI：
- skipped 或失敗：

## 部署與實機驗收
- 部署：未部署（部署與正式 smoke 由使用者本機操作）
- 使用者實機驗收：尚未驗證

## Known limitations

## Checklist
- [ ] `npm run lint` 通過（`frontend/`）
- [ ] `npm run build` 通過（`frontend/`）
- [ ] `npx vitest run` 通過，或已寫明只跑了哪些
- [ ] 帳務、command、Rules 變更有對應的 demo-easyorder Emulator 證明，不以 Vitest skip 代替
- [ ] 新增或改變 command kind 時，已同步備份 decoder／replay 與相容測試
- [ ] 行為變更有新增測試，且驅動實際入口
- [ ] 沒有 secrets、credentials、正式 config 或個資
- [ ] 已依需要更新 handoff、plan receipt、ops evidence
