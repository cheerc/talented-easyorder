# P05 command Rules access / expression budget（靜態盤點；只有三個 enabled kind 有 Emulator 證據）

## 快照與範圍

- 讀取時間：2026-10-15（Asia/Taipei）。Repo：`/workspace/talented-easyorder`；branch `codex/backend-p05-command-core`。
- P05 base：`837a1e871468db217463e9799480beeb6d7b0ab0`；本盤點隨 PR #476 更新。下列 source SHA-256 用來識別 Rules／schema／repository 快照；文件只做靜態 closure/估值，並非未啟用 kinds 的 Emulator 證據。
- 本次候選 source snapshot SHA-256：
  - `firestore.rules`: `d2b5151669613ea4399ff6ea182b07d69f9c6ba0c00b30cdf2694f67a1382a58`
  - `frontend/src/domain/cloudCommandSchema.ts`: `fe556079917d00e1c1d6a411a8f70640d7e30375fe93249808fc092676d5bcb8`
  - `frontend/src/firebase/cloudCommandRepository.ts`: `7bf2028313578584bea343179545e4b03037106d90cacc7d07bf888b7da764f1`
  - `frontend/src/domain/cloudCommands.ts`: `64a7330a893d53a35c1966efa4d7e1c00185f31727d8ea949db598ca82a13b7b`
  - `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md`: `7552e63c204fa3e878cca78310c34f0641c8a14f8842db8367254ae7152ef692`
  - `docs/superpowers/plans/2026-10-13-free-production-backend-plan.md`: `66edf8a0a4261cba57d3d7ef2e1524f4aeb515de023f2e745beed75ee75c8a2d`
- 另讀 `frontend/src/firebase/cloudCommandRepository.ts`、`frontend/src/domain/cloudCommands.ts`、canonical spec §6.1–6.3 及 plan P05。Rules/schema source anchors 及 hash 如上；任何 source 續改都必須重新算 SHA 並逐路徑盤點。
- 本文件的 call graph 與 expression-risk 分析是靜態盤點。當前真 Emulator 證據：`cloudCommands.spec.ts` 與 post-commit failure suite 在 `demo-easyorder` 使用 production `firestore.rules` 合計 79/79、0 skipped；A01/P01/P04/P05 sequential regression 144/144、0 skipped。完整命令、JSON 與限制見 [free-production evidence](free-production-evidence.md)。Emulator 沒有逐 expression／access-call runtime counter；正向通過證明選定合法樣本被接受，不把靜態呼叫圖稱為 runtime 計數。只有 `EnsureDay`、`CreateOrder`、`CreatePayment` 是當前 Rules 中允許建立的命令。表中其餘 19 kind 的 call 數是設計估值，不是實作 closure、Rules pass 或 Emulator pass。

## 當前三個 enabled kind：Repo writer 與 Rules no-cache call 圖

規則 call 計算把每個 `get`、`exists`、`getAfter` 都當獨立一次；同一 path 在同一 Rules evaluation 再讀一次仍另計，不借 Firestore cache 折抵。只計 Rules 內部文件存取呼叫，不把前端 SDK 的 `tx.get()` 直接讀取混算成 Rules `get()`。

### EnsureDay

Repo transaction read set：`commands/{commandId}`、`system/dataHead`、`operators/{uid}`、`system/accessLease`、`days/{dayId}`（5 個 client transaction reads）。成功寫 set：`days/{dayId}`、`system/dataHead`、`commands/{commandId}`（3 documents）。路徑在 `cloudCommandRepository.ts` EnsureDay branch。

| 寫入文件／Rules leaf | 逐次 Rules access call | 小計 |
|---|---|---:|
| `commands/{commandId}` create；`commandHolder`＋`validEnsureDay` | `get operators/{uid}` ×1（`approvedOperator`）；`get system/accessLease` ×1；`get system/dataHead` ×1；`getAfter system/dataHead` ×1；`getAfter days/{dayId}` ×1；`exists days/{dayId}` ×1 | 6 |
| `system/dataHead` update；`headCommand` | `getAfter commands/{commandId}` ×1；`exists commands/{commandId}` ×1 | 2 |
| `days/{dayId}` create；`ensureDayCommand` | `getAfter commands/{commandId}` ×1；`exists commands/{commandId}` ×1 | 2 |
| **Commit write Rules total** | **6 + 2 + 2** | **10** |
| Commit `VerifyMutation` for `operators/{uid}` | `signedGoogle` | **+0** |
| Commit `VerifyMutation` for `system/accessLease` | `approvedOperator` → `get operators/{uid}` ×1 | **+1** |
| **Commit atomic-request no-cache total** | **10 + 0 + 1** | **11/20** |

最大單一 write Rules evaluation 為 command create 的 6 次；SDK commit atomic-request no-cache closure 為 11 次，符合每 write ≤10、整筆 ≤20。不存在日以 `exists(day)` 作 before 檢查，再讀一次 after；不以 cache 把這兩次併成一次。operator 與 accessLease 是已讀未寫的 VerifyMutation：operator 的 `signedGoogle` dependency 為 0，accessLease 的 `approvedOperator` dependency 為 1。

### CreateOrder 與 CreatePayment

兩者同一 write graph、同一 budget。Repo transaction read set：receipt、head、operator、lease、目標 day、student、transaction existence（7 個 client transaction reads）。成功寫 set：student、day、transaction、head、command（5 documents）。成功 receipt 確認及 error recovery 的 server reads 是 transaction 外額外讀取，不列入下方寫入 Rules budget，也不能視為同一 transaction 原子證據。

| 寫入文件／Rules leaf | 逐次 Rules access call | 小計 |
|---|---|---:|
| `commands/{commandId}` create；`commandHolder`＋`validCreateTransaction` | `get operators/{uid}` ×1；`get system/accessLease` ×1；`get system/dataHead` ×1；`getAfter system/dataHead` ×1；`get days/{dayId}` ×1；`getAfter days/{dayId}` ×1；`get students/{studentId}` ×1；`getAfter students/{studentId}` ×1；`getAfter transactions/{transactionId}` ×1；`exists transactions/{transactionId}` ×1 | 10 |
| `system/dataHead` update；`headCommand` | `getAfter commands/{commandId}` ×1；`exists commands/{commandId}` ×1 | 2 |
| `days/{dayId}` update；`dayCommand` | `getAfter commands/{commandId}` ×1；`exists commands/{commandId}` ×1 | 2 |
| `students/{studentId}` update；`studentCommand` | `getAfter commands/{commandId}` ×1；`exists commands/{commandId}` ×1 | 2 |
| `transactions/{transactionId}` create；`transactionCommand` | `getAfter commands/{commandId}` ×1；`exists commands/{commandId}` ×1 | 2 |
| **Commit write Rules total** | **10 + 2 + 2 + 2 + 2** | **18** |
| Commit `VerifyMutation` for `operators/{uid}` | `signedGoogle` | **+0** |
| Commit `VerifyMutation` for `system/accessLease` | `approvedOperator` → `get operators/{uid}` ×1 | **+1** |
| **Commit atomic-request no-cache total** | **18 + 0 + 1** | **19/20** |

最大單文件 Rules evaluation 是 command create 的 10 次；四個 leaf 各 2 次。Firestore SDK `runTransaction` 會在 commit request 為已讀但未寫的 transaction documents 加入 VerifyMutation。依目前 SDK source，operator 與 accessLease 都有 verify；operator 的 `signedGoogle` 是 0 dependency reads，accessLease 的 `approvedOperator` 會額外取 operator 一次。依此 no-cache closure，EnsureDay 的 atomic request 是 10 個 write-rule access calls + 0 operator verify + 1 lease verify dependency = 11/20；CreateOrder/CreatePayment 是 18 + 0 + 1 = 19/20。每個 document write 最大仍為 10，lease verify operation 是 1。此計數由下方 SDK source anchors 與目前合法 Emulator positive 一起佐證，沒有移除 operator/lease transaction reads 來縮減預算。

SDK transaction read set 另按各自 BatchGetDocuments RPC 計：EnsureDay 有 5 個 server reads（command、head、operator、lease、day），Rules read authorization 依序為 `2(command/currentHolder)+2(head/currentHolder)+0(operator/signedGoogle)+1(lease/approvedOperator)+2(day/currentHolder)=7`；CreateOrder/CreatePayment 有 7 個 server reads，authorization 為 `2(command)+2(head)+0(operator)+1(lease)+2(day)+2(student)+2(transaction)=11`。這 7／11 次分散在讀 RPC 的 dependency calls 不假設 cache 命中，另列於 P16 read-cost 帳；不可誤讀為 0，也不額外加進已按 commit request closure 計出的 11／19 次數。Transaction 外 receipt confirmation 與 error recovery 的 server reads 亦須另計。

### 中央 command 與各投影 Rules 如何形成閉合鏈

- 中央權威在 `commands/{commandId}` create：`validCreateTransaction`／`validEnsureDay` 讀取 before head、day、student；以 `getAfter` 讀寫後 head、day、student、transaction；transaction create 另用 before `exists` 確認 ID 未使用。`commandHolder` 檢查 verified Google operator 與 current lease（各一次 `get`）。
- `commandEnvelope` 限制 command 欄位不得超出 allowlist、kind 僅限三種、actor 取自 auth token、`committedAt == request.time`、head.seq 僅加一、before/after head 與真正 head 同步；fingerprint 只做 id 重用偵測，Rules 不把它當安全授權。
- `CreateOrder`/`CreatePayment` command gate 要求 before snapshots 等於 server-read head/student/day、transaction before 為 null；要求 after snapshots 分別等於實際 `getAfter` documents，student/day revision 各 +1、`lastCommandId` 與時間一致、transaction seq/actor/timestamp 等欄位合法。學生餘額精確 delta 由 `studentCommand`/`validStudentAdvance` 驗，日 totals delta 由 `dayCommand`/`validDayAdvance` 驗，transaction payload/schema 由 `transactionCommand`/`validTransactionPayload` 驗。少寫 student/day/head 或把 command snapshot 偽裝成未變值會使 command gate 失敗；各 leaf 另拒絕不合契約的實際 writer。
- `EnsureDay` 中央 validator 要求日文件原先不存在、after 為 `getAfter(day)` 的新文件、初始 totals/status/revision/lastCommandId 精確；同筆還需 head seq+1。
- Projection leaf：dataHead 用 `headCommand`，日、學生與交易分別用 `dayCommand`、`studentCommand`、`transactionCommand`。每個 leaf 都要同一 transaction 的 `getAfter(commands/{id})` 並確認舊 command path `!exists`，比對 path/targets、command.before、command.after 與實際 before/after；學生／日 leaf 僅允許列出的 affectedKeys、revision +1、server `updatedAt`。transaction leaf 禁止 update/delete，僅允許按 command 建立；command leaf 禁止 list/update/delete。
- 因而理論設計同時要求「中心驗證要求的 writer 實際前進」與「每個實際投影 writer 只能由此新 command 授權」。head 的 seq/lastCommandId 僅容一筆相同的合法 +1 transition；舊 command 不可重新作為新投影授權。這是 source 靜態讀法，不等於目前已跑完全部 raw SDK closure/emulator adversarial gate。

## 22-kind typed target / write inventory

文件數以「一次該 kind commit 的 distinct writes」計：每筆另固定寫 1 個 `commands/{commandId}` receipt 和 1 個 `system/dataHead`。Targets 欄照 dirty `cloudCommandSchema.ts`；業務文件照 canonical spec §6.1/plan P05。未啟用 kind 現行 Rules 仍 deny；其字數/呼叫估算是設計盤點。CorrectTransaction／VoidTransaction／Undo 的 expense 路徑不寫 student projection，但 dirty schema 對前兩者仍把 studentId 定為必填；target/sentinel 或可選性須主作者確認，不可由表推定已閉合。CancelKeepDeposit／CancelRefund 是訂單取消，估值按 student projection 計。

| Kind | Typed target(s) | 業務 projection documents（設計目標） | distinct writes（含 head+command） | 現況／靜態 call-risk |
|---|---|---|---:|---|
| CreateStudent | studentId | student | 3 | Disabled；1 target，低 access-call 數，中等 schema/initial-balance 規則複雜度 |
| EditStudent | studentId | student | 3 | Disabled；1 target，中等欄位白名單/保護 balance 風險 |
| SetStudentStatus | studentId | student | 3 | Disabled；1 target，中等狀態/歷史保留風險 |
| CorrectOpening | studentId, dayId | student + opening day | 4 | Disabled；2 targets；跨日期、balance delta 與 day revision，較高 expression風險 |
| SaveVendor | vendorId | vendor | 3 | Disabled；1 target，vendor/status/schema 驗證未在 production Rules 開放 |
| RemoveVendor | vendorId | vendor | 3 | Disabled；1 target；status/revision 與不可物理刪除風險 |
| EnsureDay | dayId | day | 3 | **Enabled**；1 target；靜態 commit request no-cache 11 calls（10 writes + 1 verify） |
| SetDayMenu | dayId | day | 3 | Disabled；1 target，menu/vendor snapshot/日狀態校驗中等風險 |
| SetOpeningCash | dayId | day | 3 | Disabled；1 target，明確確認/上限/日狀態風險 |
| CreateOrder | transactionId, studentId, dayId | transaction + student + day | 5 | **Enabled**；3 targets；靜態 commit request no-cache 19 calls（18 writes + 1 verify），max 10/write；expression 高 |
| CreatePayment | transactionId, studentId, dayId | transaction + student + day | 5 | **Enabled**；3 targets；靜態 commit request no-cache 19 calls（18 writes + 1 verify），max 10/write；expression 高 |
| CreateCashMovement | transactionId, dayId | transaction + day | 4 | Disabled；2 targets；現金正負方向/理由/日統計 expression風險高 |
| CorrectTransaction | transactionId, studentId, dayId（dirty schema studentId 必填；expense 可否不投影 student 待對齊） | transaction + student + day（expense no-student variant 待定） | 5 max；若契約省略 student 則 4 | Disabled；最多3 targets；before/after delta 與現金/日統計高風險 |
| VoidTransaction | transactionId, studentId, dayId（dirty schema studentId 必填；expense 可否不投影 student 待對齊） | transaction + student + day（expense no-student variant 待定） | 5 max；若契約省略 student 則 4 | Disabled；最多3 targets；old effective value、refund/cash、day total 高風險 |
| CancelKeepDeposit | transactionId, studentId, dayId | transaction + student + day（order cancellation） | 5 | Disabled；訂單轉 payment 或 void、refund/retained cash及舊 snapshot 高風險 |
| CancelRefund | transactionId, studentId, dayId | transaction + student + day（order cancellation） | 5 | Disabled；退款需連回原 receipt、不可雙退，高 expression風險 |
| Undo | transactionId, optional studentId, dayId；payload 有 targetCommandId | transaction + day + optional student | 5 max；無 student 4 | Disabled；高風險。驗證原 command 可能需 Rules `get(commands/{targetCommandId})`；若加在 3-target command create，generic 預算將由 10 到 11/write、總數由18到19，違反 per-write≤10。讀取/閉包設計待主作者決定；本草稿不假設 SDK read 可替代 Rules 證據，也不聲稱已 closure。 |
| CloseDay | dayId, settlementRevision | day + new settlement revision | 4 | Disabled；2 targets；settlement 前版/link/head一致性 expression高 |
| ReopenDay | dayId, settlementRevision | day + new immutable settlement revision | 4 | Disabled；2 targets；原因、revision chain、前一版本關聯 expression高 |
| RecordExport | empty target | none | 2 | Disabled；0 projection targets；sourceSeq/date range 授權及查 receipt 需求待定 |
| RecordPrint | empty target | none | 2 | Disabled；0 projection targets；sourceSeq/businessDate 與被列印資料一致性待定 |
| RecordBackup | empty target | none | 2 | Disabled；0 projection targets；from/to seq、manifest/source range lookup風險待定 |
| **Inventory total** | **22 kinds** | — | **不加總** | **各 kind 是獨立交易；只有前三個 enabled，其餘19個不得計為 Emulator pass** |

### 未啟用 kind：call 與 expression 粗估公式／風險

僅作估值的投影模式假設：中央 command validator 對 head 做 before/after 兩次，對每個 N 個業務 targets 做 before/after 兩次，並做 operator + lease 各一次；每個 projection leaf 只做「command 舊不存在 + command getAfter」兩次，head leaf也是兩次。照這個尚待設計的模式：

- Command create write-path per-write 預估 `4 + 2N`；含 head leaf 與 N 個 projection leaves 的 write-path 小計 `6 + 4N`。若 repository transaction 同樣先讀取未寫入的 operator 與 lease，另依目前 SDK `VerifyMutation` dependency 保守加 lease `approvedOperator` 的 1 次（operator verify dependency 為 0），所以 atomic-request no-cache 估值為 `7 + 4N`。其餘 target/payload validation 和 Rules expression 不能由此算式代替。
- N=0 → 4 calls/create、6 write-path／7 conservative total；N=1 → 6、10／11；N=2 → 8、14／15；N=3 → 10、18／19。目標新建時 before 用 `exists`（一次）替代舊 doc `get`（一次），仍按兩次加總。這些是未啟用 kinds 的保守估值，不是已閉合的 Rules implementation 或 Emulator pass。
- 這個 generic formula 不包含額外 previous-command、vendor、target-of-target、settlement-history 查找；每加一個 Rules lookup 就在所在 write/total 各加一次。若 central `command` writer 已達10，像 `Undo` 的原 command lookup 會越過每 write 上限，必須重分配/改契約且由 Emulator 實證，不可仰賴 cache。
- Reads/writes 計數不是 expression 數量。expression 使用無法由這個 call graph推出的 Rules bytecode/短路路徑估值；高風險候選是 Correct/void/cancel/Undo、Close/Reopen、CorrectOpening。這些會同時驗完整 before/after、金額轉換、revision、immutable snapshot 和多份投影。當前 P05 production Rules Emulator 合法 positive 無 expression-cap failure；r7 negative 日誌在 31 個 case names 下出現一個或多個 cap diagnostics，31 是案例名稱數而非 diagnostic 事件數。案例數：P05.13 omitted head/student/day/transaction writer 4；P05.14 extra transaction 1；P05.15 two commands 1；P05.16 replay 1；P05.17/18 forged before/after 2；P05.21 inactive order 1；P05.28 forged actor/time/seq/epoch 4；P05.29 expired lease 1；P05.30 closed day 1；P05.31 negative/fractional/over-ceiling amounts 3；P05.32 opening amount/note, day total, menu price, vendor ID slash/length, vendor name 7；P05.34 omitted head/student/day/transaction writer while `after` matches unchanged server state 4；P05.35 approved non-holder 1。對應 `assertFails` 與 atomic unchanged assertions 通過，但不證明每個 guard individually cap-free isolated。P01 舊 proof 的 cap 診斷另外依 evidence 說明；不移除安全檢查或合法正向案例。
- Disabled kinds 現在被 `commandEnvelope` 的三-kind allowlist / create dispatcher，以及 catch-all、vendor、daily_settlements deny 關閉；這只證明目前 deny surface，不能證明任何 future Rules model 符合預算。依 P05 plan，每個 kind 開啟前須更新 schema/typed targets、中心 validator、leaf rules、逐 write no-cache call graph，並以真 Emulator 正向、拒絕、atomic unchanged 關閉。

## 主要 source anchors

- `firestore.rules`: verified operator/lease `10–35`; command envelope `166–199`; EnsureDay `239–263`; transaction central gate `307–448`; projection leaf helpers `450–514`; paths/deny surface `517–593`。
- `frontend/src/firebase/cloudCommandRepository.ts`: transaction reads and branch `349–407`; transaction after builder/writes `421–516`。
- `frontend/src/domain/cloudCommandSchema.ts`: all 22 targets `6–29`; enabled types `92–93`。
- `frontend/src/domain/cloudCommands.ts`: canonical 22-kind union `81–103`。
- Installed Firestore SDK source at `frontend/node_modules/@firebase/firestore/dist/common-b12d6a5a.node.mjs`: transaction lookup builds `BatchGetDocuments` requests at `29131`; commit appends `VerifyMutation` for read-but-unwritten documents at `29165`; commit writes are assembled at `25132` (line anchors are tied to the installed package in this workspace)。
- canonical spec §6.1–6.3 (business targets, commit closure, 18/20/10 design) and plan P05 §150–160 (three enabled kinds and required Emulator gates).

## Future disabled-kind design constraints

1. This no-cache graph is tied to the hashes in the snapshot section. Any Rules/schema/repository change requires recomputing hashes and reviewing every path; use actual Emulator positive/negative/atomic unchanged evidence alongside the graph.
2. The read graph is based on installed SDK source and Firestore Rules paths. Preserve the separate 7/11 BatchGet read-RPC dependency ledger for P16 cost estimates; do not count it as zero or add it again to the commit request’s 11/19 closure.
3. Before enabling disabled correction/cancel/undo kinds, define expense-record target nullability/sentinel rules and preserve command-to-original-command verification within per-write and per-request limits.
4. Each disabled kind requires its own runtime closure, no-cache write/read graph, legal positive, raw-SDK negative, and atomic unchanged Emulator proof before enablement. This inventory is not Emulator evidence for those kinds.

## P06 student command WIP (not yet an accepted budget)

This appendix tracks the P06 candidate separately from the immutable P05 evidence above. P05 was accepted with three enabled kinds; the current P06 source branch is implementing three student kinds, but no P06 Emulator proof has been recorded yet. Do not read candidate Rules allowlisting as acceptance evidence.

The intended successful write set for each student command is `commands/{commandId}`, `system/dataHead`, and exactly one `students/{studentId}` document. The intended Rules graph is: command writer checks operator, lease, before/after head, and before/after student; head leaf checks command old-absence and `getAfter(command)`; student leaf does the same. Under that graph, candidate static count is command write 6, head leaf 2, student leaf 2, plus the SDK read-but-unwritten lease VerifyMutation dependency 1 (operator dependency 0): 10 Rules calls across writes / 11 per atomic request, with max 6 on any one write. This estimate must be re-walked against final source, including helper inlining/call behavior and exact transaction read set, before it is treated as the P06 static budget.

P06-specific expression-cap closure has not been observed. The positive cases must prove all three legal commands pass on actual production Rules; negative cap output must name cases and causal isolation limitations. Existing P05 three-kind legal positives and historical 31 negative case-name cap caveat remain separate. Reads used by complete student-list paging and readCommand are server read RPC authorization cost, not atomic write budget; list completeness and stable-head behavior need their own tests. This appendix intentionally makes no claim of runtime access-call instrumentation or final Rules closure.
