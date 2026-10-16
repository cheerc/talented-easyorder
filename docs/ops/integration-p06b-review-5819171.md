# P06b＋前端本地整合 scoped review：PASS

**精確 HEAD：`58191718e2388bfbf954314128f5357370e65123`。**
先以 `git rev-parse integration/operator-feedback-p06b` 核實，獨立 review worktree detached checkout；實際 parents 為前端 `c133d09386d997096ec404a7a3a281521ebd0597` 與 P06b `2a03953b90a3cd477a7918ebea6741675ac2e428`。本輪為獨立整合驗證，並非直接沿用兩個 parents 的 PASS。

**結論：本輪無已確認 blocking finding，整合 PASS。** 未改產品、未 push／merge／部署／開展 P08；本收據初稿存於 review 環境，未發布 GitHub／Artifact。

## 1. 合併解法與真消費端

實讀 combined diff 與完整消費位置，正規化已合為單一 `normalizeStudentCodeCore(input: unknown)`：
- trim → 全形數字轉半形 → 純數字驗證 → 去除前導零 → 非零且有效位數≤6 → 數字轉換 → 至少三位canonical＋regex檢查。
- Prototype `normalizeStudentCode(raw)` 直接回Result，非法不throw，保留 `ok:false/reason`。
- Cloud `normalizeStudentCodeOrThrow(input)` 成功只回code字串，失敗用core同一reason拋Error；沒有失敗轉空字串／吞錯。
- `cloudCommandSchema.studentCodeValue` 與 `CloudStudentsPage` 建立／改號真入口均已切throw adapter；schema保留InvalidCloudCommandInput、頁面保留使用者錯誤提示與拒送。
- Prototype `student.ts` 新增驗證／缺號排序、`AdminScreen` 改號／碰撞檢查、`posSearch` 的F1真候選／一般搜尋／掃碼仍使用Result adapter，沒有錯把object當code或對字串讀ok。
- Cloud repository／schema decoder仍直接用嚴格STUDENT_CODE_REGEX拒絕noncanonical server資料；不是把畸形伺服器資料悄悄正規化。
- 舊rawID（5／005）以Map<number, StudentAccount[]>保留全部帳戶並標collision，停用仍占號；非數字舊ID排尾，沒有覆蓋／丟帳戶。

`git diff --quiet 2a03953 HEAD -- firestore.rules frontend/src/firebase/cloudCommandRepository.ts frontend/src/firebase/cloudStudentRepository.ts frontend/src/firebase/firestoreSchema.ts` **exit0**：穩定UUID、studentCode索引、before/after閉合及Rules與已審P06b產品相同；兩個Cloud真normalizer消費端只有import／adapter名稱調整。

## 2. 單一核心與Rules canonical一致：獨立新增外部驗證

外部 harness `integration-normalizer.test.ts` 使用真實source import，不複製normalizer實作；**3/3 passed，無skip**：

1. **遍歷全部999999個合法數值**，兩adapter輸出與獨立expected `String(n).padStart(3,'0')`完全一致，且都匹配從目前firestore.rules實際讀取的validStudentCode regex及共用TS regex。
2. 10000個ASCII／全形前導零加有效code、trim、1000、999999仍為唯一canonical；10000純零／超長有效位數、前導零加1000000、負號／加號／小數／科學記號／內部空白／其他數字字元／零寬字元／非字串型別都拒絕。兩adapter與core錯誤一致，throw adapter確實以Result reason拋錯。
3. 真`validateNewAccount`對超長全形前導零仍阻擋既有停用raw5碰撞；gap builder保留兩個碰撞帳戶與舊guest；真`normalizeEnabledCommandInput(CreateStudent)`得到字串005，非法input確實throw，不接受Result物件代替payload。

永久 `student.test.ts` 本版**共26 cases**（含既有測試，不宣稱全部為新加），與posSearch16及完整App3另跑明確收據：**3files／45 passed，無skip**。

## 3. Prototype 完整App／持久化與舊回歸

- 原U3外部回歸：**10/10 passed**；F1全形／冗餘零實際候選、rawID碰撞保留、數次改號／舊號他人重用、歷史歸戶、validator／snapshot與完整persist。
- 原完整App外部3案：**3/3 passed**。F3停用005→009真正改號確認、退款120、modal快捷鍵隔離、F5精確歸戶與離頁target清除；實際storage→新reader rehydrate→重設singleton記憶體→rehydrate／App remount後餘額180與退款仍在；真UI撤回恢復300、5秒倒數到期保留退款。
- 永久`integrationApp.test.tsx`3案亦實際重跑通過，無skip。
- 上述重載證據仍為jsdom localStorage fallback／remount，不升格宣稱prototype Chromium IndexedDB跨功能reload。

## 4. Cloud真UI與Browser整合驗證

原外部Cloud UI **3/3 passed**：可見編號label，以及ChangeStudentCode UNKNOWN_RESULT後「查無receipt→同ID重試」與「找到receipt→同ID重播核對」。輸入全形５，真頁面使用throw adapter正規化新code005；兩次repository input的UUID、commandId、revision、reason、目標005完全相同，label原002→005不錯號。

本輪由reviewer於同整合SHA獨立執行：
```sh
npm --prefix frontend run test:e2e
```
**exit0，Cloud Chromium15 passed（46.2s）＋prototype Chromium7 passed（7.8s）**。不是沿用作者或P06b親版本結果。

實際D01涵蓋UUID主檔與studentCodes索引、改號002→015並page.reload、缺號預填與搜尋隱gap、占用拒絕、停用001→099、舊001重用與最終server索引。Cloud webServer由整合source實際執行正式build成功；Auth／Firestore為demo-easyorder，正常shutdown。lease競爭／模擬快慢時鐘原有console警告不隱藏，不算測試失敗。

## 5. 整合版真Rules：必要範圍獨立驗證，不宣稱263全套重跑

雖Rules檔與2a03953 byte-identical，仍實際以整合source／shared core在獨立Firestore-only ports（28087／hub24487／log24587）測試；明確指定demo-easyorder、目前worktree Rules，REQUIRE_CLOUD_COMMANDS／STUDENTS=true，no-file-parallelism。

- `cloudCommands.spec.ts` **170**。
- `cloudStudentRepository.spec.ts` **12**。
- `cloudCommandRepository.failure.spec.ts` **6**。
- 合計 **188/188 passed，0 failed／0 skipped，exit0**。
- 原外部Rules對抗 **44/44 passed，無skip，exit0**。
- 包含原R1c（舊索引before缺失＋省略delete writer）中央拒絕、permanent P06b.6b、他人／額外索引、歷史command重放、revision／operator／lease／maintenance及strict before/after。
- 合法最壞Create／Change SDK正向（10別名各100、姓名100、note500、reason500、負額邊界／新code999999）通過；不僅短input或raw batch。
- static no-cache budget仍中央10／leaf9／leaseVerify1＝**20/20**、單write **10/10**，沒有因合併增加存取，不能再添get/exists而不重算。

**未跑範圍：本整合SHA未重新啟用firestoreRules10、cloudRulesProof36、activeAccountLease19、cloudDayVendorRepository10四套獨立Emulator suites（合計75）。它們在全量unit中屬skip，不當通過；因此本收據不聲稱整合版263/263真Rules全套通過。** 本輪188必要Rules＋44外部對抗足以覆蓋改動normalizer的真command/list/unknown-result消費與closure/max；Cloud15 Browser另有lease／vendor/day回歸，但不冒充該四套Rules測試。

## 6. 全量、lint與TypeScript基線

- `npm --prefix frontend exec -- vitest run --root frontend` → **exit0，160files passed／7skipped，1557tests passed／263skipped**。263skip不算真Emulator pass，已另以上節區分。
- `npm --prefix frontend run lint` → exit0。
- build：本輪Browser webServer以目前source的 `npm run build` 成功啟動preview；保留既有Vite `__dirname`native loader警告。
- `git diff --check c133d09 HEAD` → exit0。
- 匯出前端親版本c133d09，共用同node_modules，兩邊 `tsc -b --pretty false` **各exit1／211diagnostics；完整輸出byte-identical，normalizedADDED0／REMOVED0**。不宣稱TSC通過，亦不拿P06b原base229與前端base211直接做數量推論。

## 收據／環境狀態

最終 `git rev-parse HEAD` 及 `git rev-parse integration/operator-feedback-p06b` 均為本收據精確SHA；`git status --short`無輸出。測試emulator正常關閉，9099／8080／4173／5175／28087均無LISTEN。

**最終：前端Result與Cloud throw adapter整合已實際驗證；本輪PASS，交coordinator決定後續，不代表push／merge或本人業務驗收授權。**
