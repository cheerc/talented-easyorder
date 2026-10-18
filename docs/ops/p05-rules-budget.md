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

## P06 student write budget WIP

This appendix tracks the P06 source separately from the immutable P05 evidence above. P05 was accepted with three enabled kinds; current P06 source adds CreateStudent, EditStudent, and SetStudentStatus, making six allowed kinds in total and leaving the other 16 denied. Actual production Rules Emulator suites now have positive and negative P06 evidence, but the phase remains WIP pending browser/product gates, full regression, CI, and independent review.

Each successful student command writes exactly `commands/{commandId}`, `system/dataHead`, and one `students/{studentId}` document. The concrete Rules graph in the current source is:

| Rules evaluation | Calls (no cache credit) | Per-write subtotal |
|---|---|---:|
| Student command create: `commandHolder` (operator + lease); before/after head; Create target before/after (`exists` + `getAfter`) or mutation target (`get` + `getAfter`) | `get operators` ×1, `get accessLease` ×1, `get dataHead` ×1, `getAfter dataHead` ×1, student before ×1, `getAfter student` ×1 | 6 |
| `dataHead` update leaf | `getAfter command` ×1 + `exists command` ×1 | 2 |
| Student create/update leaf | `getAfter command` ×1 + `exists command` ×1 | 2 |
| **All write Rules evaluations** | **6 + 2 + 2** | **10** |
| SDK read-but-unwritten VerifyMutation for operator | `signedGoogle` dependency | **+0** |
| SDK read-but-unwritten VerifyMutation for lease | `approvedOperator` dependency reads operator | **+1** |
| **Atomic request no-cache total** | **10 + 0 + 1** | **11/20** |

The successful client transaction has five BatchGet reads: command receipt, data head, operator, access lease, and target student. Rules dependencies on those read RPCs are separately chargeable and are not folded into the 11-call commit request total. There is no runtime Rules-call counter in the Emulator; this is a source call graph, independently checked against current helper branches and SDK VerifyMutation behavior. Max single write is six calls (below 10); complete commit is 11 (below 20).

The full unfiltered demo Emulator run on 2026-10-15 passed `cloudCommands.spec.ts` 97/97 and `cloudStudentRepository.spec.ts` 11/11: 108 passed, 0 failed, 0 skipped, exit 0 (`/tmp/p06-unfiltered-cloud.json`). The 40-test `-t P06` run is a separate focused result; its 57 not-selected tests are not passes. The accepted P06 positives include all three command kinds, legal goLive/today opening dates, signed integer boundaries, same-name students, `001` string identity, duplicate ID rejection, max 10 aliases, and a raw SDK create with the actual head/student writers. Create/Edit/Status writer omission and forged/non-coherent payload cases assert denial and atomic unchanged.

The initial raw CreateStudent case with ten max-length aliases encountered the Emulator's 1000-expression ceiling because the full student alias schema was evaluated both in the central command gate and in the student leaf. Candidate source was changed to compare the command payload to the real `getAfter(student)` in the center and perform the full schema check once at the leaf; the 10-alias legal case and all 108 current unfiltered cloud tests now pass. Denial logs for some P05 and P06 adversarial cases still contain max-1000 diagnostics (visible in `/tmp` execution output); assertFails + unchanged state proves the operation did not commit, but does not isolate every underlying guard as cap-free. We do not claim every negative predicate has an independent no-cap proof.

`listCloudStudents` uses `getDocsFromServer`, ordered document-ID cursor pages (200 each), strict complete DTO/path/schema validation, and before/after dataHead seq/dataset/goLiveDate comparison. Emulator tests prove 500 synthetic records are complete across pages and 501 fails closed as `INCOMPLETE_SNAPSHOT`, never returning an incomplete roster. This source phase does not claim complete list UX above 500; handling the larger/inactive roster belongs to a later capacity phase. List queries, head reads, and `readCommand` reads are server read cost, not atomic write budget.

Rules `students get,list` use `currentHolder()` so `get` of an absent target can authorize the transaction needed for CreateStudent and a query need not claim to filter arbitrary schema fields. The server repository validates every returned document before publishing any results. Display name and aliases are coherent literal nonempty strings of length 1–100 in Rules, normalization, receipt decoding, and list decoding; aliases are at most 10. Emulator cases accept representative ASCII whitespace, NBSP, BOM, and a name containing a newline with visible text, and reject an empty string, avoiding Unicode trimming/regex drift.

P05 accepted positives and its older negative-case cap caveat remain as documented above; these P06 results do not retroactively improve that isolation. Full P06 phase acceptance still requires prescribed sequential regression, D01/UI auth-loss and second-browser E2E, prototype 7 cases, full Vitest/lint/build/TSC normalized comparison, required CI on the immutable source SHA, and independent review. No production keys, bootstrap, or deploy are used.

## P07 day/vendor write budget — current WIP, not accepted

This appendix is a static source-based estimate for the current P07 Rules candidate, SHA-256 `0392052e3a1f80d51bf8344e954f294b2170511911a2c070762de024bcfb6f39`. It includes the reviewed SaveVendor create receipt/status guards and actual SetOpeningCash integer checks. P07 adds exactly `SaveVendor`, `RemoveVendor`, `SetDayMenu`, and `SetOpeningCash` to the six already-enabled kinds; 12 remain denied. The successful transaction write set for each new kind is the command receipt, `system/dataHead`, and one target vendor or day. These counts give no cache credit to repeated Rules calls and are not expression counts.

| Command/write path | Central command-create Rules calls | Projection leaf Rules calls | Read-but-unwritten `VerifyMutation` dependencies | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|---:|
| `SaveVendor` / `RemoveVendor` (create or update vendor) | commandHolder 2 + head before/after 2 + vendor before/after 2 = **6** | head 2 + vendor 2 = **4** | operator 0 + lease `approvedOperator` 1 = **1** | **11/20** | **6/10** |
| `SetOpeningCash` (update day) | commandHolder 2 + head before/after 2 + day before/after 2 = **6** | head 2 + day 2 = **4** | operator 0 + lease `approvedOperator` 1 = **1** | **11/20** | **6/10** |
| `SetDayMenu` direct vendor assignment (update day) | commandHolder 2 + head before/after 2 + day before/after 2 + active vendor 1 = **7** | head 2 + day 2 = **4** | operator 0 + lease 1 + read-only vendor `currentHolder` 2 = **3** | **14/20** | **7/10** |
| `SetDayMenu` inherited assignment (update day) | commandHolder 2 + head before/after 2 + target day before/after 2 = **6** | head 2 + day leaf receipt/exists 2 + source day 1 + vendor 1 = **6** | operator 0 + lease 1 + read-only vendor `currentHolder` 2 + source day `currentHolder` 2 = **5** | **17/20** | **6/10** |

The client transaction BatchGet authorization dependency totals are separate from commit closure: vendor writes read 5 documents (command, head, operator, lease, vendor), for `2 + 2 + 0 + 1 + 2 = 7` dependency calls; opening cash reads the same five and also totals **7**. Direct menu reads six documents and totals **9** (`2 + 2 + 0 + 1 + 2 + 2`); inherited menu reads seven and totals **11** after adding source day's two `currentHolder` dependencies. These read-RPC costs are not added again to the commit request totals above. Receipt confirmation, recovery reads, and snapshot/list paging are also outside the atomic write closure.

The inherited path retains a complete `validDay(sourceDay)` and vendor schema/current identity checks, binds source business fields to the target menu's exact eight-key map, and moves source/vendor reads into the mandatory day update leaf. Central still binds actual head and target-day before/after, strict target revision advance, fresh receipt, server time, current holder, and lease. `validDayNonMenu(after)` and all existing schema, calendar, payload, and deny checks remain. Rules cannot prove that the cited source is globally the newest eligible menu; repository paging and `expectedRevisions.headSeq` own that proof. This design's static no-cache write closure is 14/20 direct and 17/20 inherited, with max 7/10 and 6/10 per write. It is a source call graph, not a runtime access counter, and does not prove the expression cap is met.

The client BatchGet totals include read-only vendor/source documents; SDK `VerifyMutation` dependencies are separately included in the atomic commit totals above. Direct path dependencies: command 2 + head 2 + operator 0 + lease 1 + target day 2 + vendor 2 = **9**. Inherited adds source day 2 = **11**. No SDK cache credit is assumed.


The Rules review's two static findings are closed at exact source SHA `9923a0385bfec572ae1ae7f8f6eedc0ba8c436dd`. Six raw SaveVendor create cases vary or omit `payload.status` and `before.vendor` while preserving the real writers; all deny atomically. Their logs still include max-1000 expression diagnostics, so the denial/unchanged-state results and source predicate analysis support closure but do not constitute isolated cap-free guard proofs. Three REST cases prove a legal authenticated integerValue SetOpeningCash commit (HTTP 200) and atomically deny doubleValue actual `openingCash` and `revision` projections (HTTP 403). Those nine cases passed in the full unfiltered command suite. The `cloudCommands.spec.ts` source SHA-256 is `9e168967130498712ab73b08db5efe664bcd66d3d38151103ccde8fd049a484d`. The exact reports on prior reviewed SHAs and their follow-ups are preserved in [Rules/budget review](p07-r9-exact-rules-review-5e7362d.md), [continuation review](p07-review-5e7362d7c8543fa329f0af2a2d0456f0dc0b9b4b.md), and the [exact-source findings closure](p07-rules-finding-closure-9923a038.md). These finding closures do not close P07's remaining legal-positive cap blocker.

On exact current Rules hash above, the unfiltered `cloudCommands.spec.ts` run passed 148/149; the only failure, `P07.9: raw SetDayMenu inherits the immediate source menu with a frozen snapshot`, hit Firestore's 1,000-expression ceiling. JSON/log/exit: `/tmp/p07-p05-p07-commands-r11.{json,log,exit}`. Diagnostics report the same closure at multiple matched write locations; this does not identify one isolated predicate or prove any failed negative assertion's guard independently cap-free. Do not lower schema, remove a writer/auth guard, or claim P07 accepted from static estimates. A legal inherited positive below the cap remains required before this phase can close.

### P07 per-document expression ceiling and inherited source split — 2026-10-15

Current Rules SHA-256 `e06d11add203dc253ad66d699d0592bfbb9f1511086610477f214e3df91a3fab`. A padding probe (scratch Rules copies with an added `pad10()` chain placed in one `allow` rule at a time, run against the demo Emulator) showed that Firestore applies the 1,000-expression ceiling to each document's rule evaluation, not to the whole commit: padding the `dataHead` rule did not change the day rule's failure point, and the reverse. In the old candidate the inherited `SetDayMenu` day rule exceeded its own ceiling, while the `dataHead` rule had most of its budget free. Removing either `validDay(sourceDay)` or `validDayNonMenu(after)` from the day rule alone made `P07.9` pass, so the overrun was small.

The current Rules keep every check and move only `validDay(sourceDay, sourceDate)` to `headInheritedMenuSourceDay`, which `headCommand` evaluates on the `system/dataHead` write that every command commit must include (the command rule requires `headAfter.seq == head.seq + 1`). The day rule still checks the source menu fields, the active/undeleted/same-name vendor, the exact eight-key target menu, `validDayNonMenu(after)`, the before-day checks, and the receipt link. All three writes belong to one atomic commit, so a denial on any of them rejects the whole commit.

Measured headroom on the current Rules, in probe units (one unit = `pad10()`), for the worst legal inherited path `P07.9a`: target day already has a menu, the source day is reopened with confirmed opening cash and nonzero totals. The day rule passes with +20 and fails with +30. The `dataHead` rule passes with +40. The direct `SetDayMenu` command-create rule had +10 (fails at +20) before this change and is unchanged. These are probe margins, not runtime counters.

Static no-cache access calls for the inherited path change by one: the head leaf now also `get`s the source day (head 2 → 3). Atomic total **18/20**; max per write is still **6/10**. Direct and other P07 kinds are unchanged.

Exact-source sequential Emulator regression (demo-easyorder, no skips): A01 10/10, P01 36/36, P04 19/19, P05/P07 commands 156/156 (including `P07.9a` and six `P07.9b` source-day negatives that fail on a mutant with the dataHead check removed), post-commit 6/6, P06 student reads 11/11, P07 day/vendor reads 10/10. Total 248 passed, 0 failed, 0 skipped.

## P06b student stable keys and changeable code write budget — static design & call graph

This appendix documents the P06b static design and Rules access budget for separating stable UUID internal keys (`studentId`) from changeable display codes (`studentCode`, canonical format `001`–`999999` with regex `^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,5})$`).

P06b adds exactly one enabled command kind: `ChangeStudentCode`, bringing the total enabled kinds to 11 (`EnsureDay`, `CreateOrder`, `CreatePayment`, `CreateStudent`, `EditStudent`, `SetStudentStatus`, `SaveVendor`, `RemoveVendor`, `SetDayMenu`, `SetOpeningCash`, `ChangeStudentCode`); remaining 12 kinds stay denied.

P06b also introduces the unique index collection `studentCodes/{studentCode}` and specifies the sole client delete exception under canonical spec §6.3: deleting `studentCodes/{oldCode}` during atomic `ChangeStudentCode`.

### Write budget inventory for P06b kinds

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Read-but-unwritten `VerifyMutation` dependencies | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|---:|
| `CreateStudent` (creates student + studentCode index) | commandHolder 2 + head before/after 2 + student exists/getAfter 2 + studentCode exists/getAfter 2 = **8** | head 2 + student 2 + studentCode create 2 = **6** | operator 0 + lease `approvedOperator` 1 = **1** | **15/20** | **8/10** |
| `ChangeStudentCode` (updates student, creates newCode index, deletes oldCode index) | commandHolder 2 + head before/after 2 + student before/after 2 + newCode exists/getAfter 2 + oldCode get/existsAfter 2 = **10** | head 2 + student 2 + newCode create 2 + oldCode delete (studentAfter 1 + command 1 + exists 1) 3 = **9** | operator 0 + lease `approvedOperator` 1 = **1** | **20/20** | **10/10** |
| `EditStudent` / `SetStudentStatus` (unchanged from P06) | commandHolder 2 + head before/after 2 + student before/after 2 = **6** | head 2 + student 2 = **4** | operator 0 + lease `approvedOperator` 1 = **1** | **11/20** | **6/10** |

### Old index delete authorization closure

In Firestore Security Rules for `delete` operations, `request.resource` is null. The delete rule on `studentCodes/{code}` securely acquires the authorizing `commandId` via:
1. `let studentAfter = getAfter(/databases/$(database)/documents/students/$(resource.data.studentId)).data;`
2. `let currentCommandId = studentAfter.lastCommandId;`
3. `let command = getAfter(/databases/$(database)/documents/commands/$(currentCommandId)).data;`
4. Strict validation:
   - `!exists(/databases/$(database)/documents/commands/$(currentCommandId))` (command must be freshly created in the same atomic commit)
   - `command.commandId == currentCommandId`
   - `command.kind == 'ChangeStudentCode'`
   - `command.targets.studentId == resource.data.studentId`
   - `command.before.student.studentCode == code` (the code of the document being deleted matches the student's before snapshot)
   - `command.after.student.studentCode != code && command.after.student.studentCode == command.payload.studentCode`
   - `studentAfter.studentCode == command.payload.studentCode`

This design specifies the static authorization closure without relying on client-supplied IDs or caching. It estimates 3 access calls in the delete leaf rule evaluation and 20 no-cache access calls for the entire atomic commit (10 for central create, 9 for projection leaves, 1 for lease VerifyMutation, reaching the exact 20/20 limit and 10/10 single write ceiling). These figures are static WIP estimates subject to Emulator proof, and the independent 1,000-expression ceiling per document write must be verified in the test suite before claiming compliance.

## P09a cloud payments and counter cash movement — budget and probe receipt

P09a enables `CreateCashMovement` (12 enabled kinds; 11 still denied). `CreatePayment` keeps its P05 path and Rules unchanged; P09a only opens its F1 entry (W). Contract: [P09a cloud payments and cash contract](../superpowers/specs/2026-10-16-cloud-payments-cash-contract.md).

### Write budget

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Read-but-unwritten `VerifyMutation` dependencies | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|---:|
| `CreateCashMovement` (command + dataHead + day + new transaction; no student) | commandHolder 2 + head before/after 2 + day before/after 2 + transaction getAfter/exists 2 = **8** | head 2 + day (command getAfter/exists) 2 + transaction (command getAfter/exists) 2 = **6** | operator 0 + lease `approvedOperator` 1 = **1** | **15/20** | **8/10** |

### Placement and expression headroom

Each new branch is the last alternative in its `||` chain (command create dispatch, `dayWriteCommand`, `transactionCommand`), so existing kinds stop before reaching it. The transaction document check is one exact map equality (24 keys) instead of `exactMap` plus 24 field equalities; the semantics are the same and it is evaluated in both the command rule and the transaction leaf.

Probe method: insert N inline `1 == 1 &&` terms at the start of one rule's condition and bisect pass/fail against an existing positive Emulator case (`EASYORDER_TEST_RULES_PATH` points the suite at the probe file). One unit is one inline term, finer than the `pad10()` units used in the P07 appendix. These are probe margins, not runtime counters.

| Rule anchor | Case | main `fc79439` (pass / fail) | P09a (pass / fail) |
|---|---|---:|---:|
| day update | `P07.9a` inherited menu (worst day path) | +28 / +29 | +28 / +29 |
| day update | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| transaction create | `P08.8` CreateOrder | +34 / +35 | +34 / +35 |
| command create | `P08.8` CreateOrder | +17 / +18 | +16 / +17 |
| day update | `P09.8` cash movement, max payload | — | +48 / +49 |
| transaction create | `P09.8` cash movement, max payload | — | +95 / +96 |
| command create | `P09.8` cash movement, max payload | — | +26 / +27 |
| dataHead update | `P09.8` cash movement, max payload | — | passes at +80 |

The first cash-path draft compared the transaction document field by field and left the command rule at +0 / +1 for `P09.8`. Rewriting that check as one map equality raised it to +26 without dropping any check; a mutant that changes one expected field (`sourceDevice`) makes the seven positive cash cases fail.

P09b (`CreateRefund` plus `day.totals.accountRefunds`) touches `validTotals`, `validNewDay`, `validDayAdvance` and `validDayNonMenu`, which every day path evaluates. Re-measure `P07.9a` (day +28) and `P08.8` (day +11) before and after that change.

## P09b account refund — budget and probe receipt

P09b enables `CreateRefund` (13 enabled kinds; 11 still denied) and adds `accountRefunds` as the eighth `day.totals` field. Contract: [P09b account refund contract](../superpowers/specs/2026-10-16-cloud-refund-contract.md).

### Write budget

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Read-but-unwritten `VerifyMutation` dependencies | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|---:|
| `CreateRefund` (command + dataHead + day + student + new transaction) | commandHolder 2 + head before/after 2 + day before/after 2 + student before/after 2 + transaction getAfter/exists 2 = **10** | head 2 + day 2 + student 2 + transaction 2 = **8** | operator 0 + lease `approvedOperator` 1 = **1** | **19/20** | **10/10** |

Same shape as `CreatePayment` (P05), as the operator-feedback plan requires.

### Day totals 7 → 8 fields

`validTotals` now requires exactly 8 keys, `validNewDay` requires `accountRefunds == 0`, and every existing projection (`CreateOrder`, `CreatePayment`, `CreateCashMovement`) requires `accountRefunds` unchanged. `validDayNonMenu` uses `validTotals`, so it is covered. A day document with the old 7-field totals is refused on read (`UNSUPPORTED_SCHEMA`) and every write to it is denied (`P09b.13`). There is no production data yet (nothing has been deployed), so no migration is needed; any Emulator data from before P09b must be recreated.

To pay for the extra field, `validDayAdvance` compares the unchanged totals as one map equality over all 8 keys instead of `exactMap` plus per-key equalities. The per-field `is int`, `>= 0` and `<= 1e9` bounds are kept. The refund transaction document check is one 24-key map equality, like P09a's cash movement.

### Expression headroom

Same probe method as the P09a appendix (inline `1 == 1 &&` terms, bisected against an existing positive Emulator case). A student-rule anchor was added for P09b.

| Rule anchor | Case | main `c444621` (pass / fail) | P09b (pass / fail) |
|---|---|---:|---:|
| day update | `P07.9a` inherited menu | +28 / +29 | +24 / +25 |
| day update | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| transaction create | `P08.8` CreateOrder | +34 / +35 | +34 / +35 |
| command create | `P08.8` CreateOrder | +16 / +17 | +16 / +17 |
| student update | `P08.8` CreateOrder | +22 / +23 | +22 / +23 |
| day update | `P09.8` cash movement, max payload | +48 / +49 | +39 / +40 |
| command create | `P09.8` cash movement, max payload | +26 / +27 | +26 / +27 |
| day update | `P09b.9` refund, max payload | — | +38 / +39 |
| transaction create | `P09b.9` refund, max payload | — | +95 / +96 |
| student update | `P09b.9` refund, max payload | — | +88 / +89 |
| command create | `P09b.9` refund, max payload | — | +14 / +15 |
| dataHead update | `P09b.9` refund, max payload | — | passes at +80 |

Without the `validDayAdvance` rewrite, the day rule for `P08.8` fell from +11 to +1. The tightest anchor is now the refund command rule (+14); re-measure it before adding checks there.

### Mutants

Each mutant removes one refund check from `firestore.rules` and runs the matching `cloudRefund.spec.ts` case:

| Removed check | Result |
|---|---|
| amount ≤ current balance (command and student rules) | killed |
| `accountRefunds` advanced by amount | killed |
| student balance lowered by amount | killed |
| `cashEffect` literal | killed |
| `command.reason == payload.reason` | killed |
| student diff limited to balance / revision / lastCommandId / updatedAt | killed |
| `command.studentId == studentId` | killed |
| day `status in ['open', 'reopened']` in the refund projection | survived: redundant, because the day `affectedKeys` limit already blocks status changes and the command rule checks the status too |

The Rules suite without the P09b Rules (main's Rules against the refund spec) fails 8 of 43 refund cases, so the new tests depend on the new Rules.

## P10a transaction mutations — budget and probe receipt

P10a enables `CorrectTransaction`, `VoidTransaction`, `CancelKeepDeposit`, `CancelRefund` and `Undo`. After merging main `b33fc6b` (P14 adds `RecordBackup`), 19 kinds are enabled and 5 still denied. Contract: [P10a transaction mutations contract](../superpowers/specs/2026-10-16-cloud-transaction-mutations-contract.md).

### Write budget

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Read-but-unwritten `VerifyMutation` dependencies | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|---:|
| Student row (command + dataHead + day + student + existing transaction update) | commandHolder 2 + head before/after 2 + day before/after 2 + student before/after 2 + transaction get/getAfter 2 = **10** | head 2 + day 2 + student 2 + transaction 2 = **8** | operator 0 + lease `approvedOperator` 1 = **1** | **19/20** | **10/10** |
| Counter-cash row (`__cashier__`; no student write) | commandHolder 2 + head 2 + day 2 + transaction 2 = **8** | head 2 + day 2 + transaction 2 = **6** | **1** | **15/20** | **8/10** |

The transaction leaf is the new `allow update` on `transactions/{id}` (`transactionMutationCommand`: `getAfter` + `exists` of the command). `allow delete` stays `false`.

### Command dispatch rewrite

The mutation branch is the last of the command-create `||` chain. With the old dispatch (`request.resource.data.kind` read in every branch), the first measurement of `P10.17` left only **+1**. Two changes recovered it:

1. `allow create` now calls `validCommandCreate(commandId, command)`, which binds `let kind = command.kind` once; every earlier branch costs one comparison instead of a `request.resource.data` lookup. This also raises the headroom of every existing kind (table below).
2. `validTransactionMutationCommon` leaves out checks that existing invariants already guarantee:
   - the kind (the dispatch checked it);
   - the `transactionId` format, the `dayId` calendar format and `dayId >= goLiveDate` (the transaction exists with `businessDate == dayId`, both were validated at creation, and `goLiveDate` cannot change);
   - `txAfter.lastCommandId` (the transaction update rule requires it; the revision bump proves that write is in the batch);
   - `txBefore.type != 'expense'` on the student path (every expense row belongs to `__cashier__`).

Full Emulator regression after the rewrite: 22 files, 491/491.

### Expression headroom

Same probe method as the P09a/P09b appendices: inline `1 == 1 &&` terms at the rule anchor, bisected against a positive Emulator case. A probe raises the cost of **every** write to that document in the case, so a P10 case that first creates an order or payment is capped by that create. Cells marked † are therefore lower bounds for the mutation itself (they equal the create's own headroom).

| Rule anchor | Case | P09b (main `e01ebdf`) | P10a |
|---|---|---:|---:|
| day update | `P07.9a` inherited menu | +24 / +25 | +23 / +24 |
| day update | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| command create | `P08.8` CreateOrder | +16 / +17 | +20 / +21 |
| student update | `P08.8` CreateOrder | +22 / +23 | +22 / +23 |
| transaction create | `P08.8` CreateOrder | +34 / +35 | +34 / +35 |
| day update | `P09.8` cash movement, max payload | +39 / +40 | +39 / +40 |
| command create | `P09.8` cash movement, max payload | +26 / +27 | +31 / +32 |
| command create | `P09b.9` refund, max payload | +14 / +15 | +19 / +20 |
| day update | `P09b.9` refund, max payload | +38 / +39 | +37 / +38 |
| student update | `P09b.9` refund, max payload | +88 / +89 | +88 / +89 |
| command create | `P10.17` every kind, 500-char reason and note | — | +19 / +20 |
| transaction update | `P10.17` | — | +96 / +97 |
| dataHead update | `P10.17` | — | +95 / +96 |
| command create | `P10.1` order correction | — | +20 / +21 |
| day update | `P10.1` | — | +11 / +12 † |
| student update | `P10.1` | — | +22 / +23 † |
| command create | `P10.3` cancel with refund | — | +20 / +21 |
| command create | `P10.5` payment undo | — | +20 / +21 |
| day update | `P10.5` | — | +13 / +14 † |
| student update | `P10.5` | — | +23 / +24 † |
| transaction update | `P10.5` | — | +96 / +97 |
| command create | `P10.12` refund corrections | — | +19 / +20 |
| day update | `P10.12` | — | +37 / +38 † |
| student update | `P10.12` | — | +78 / +79 |
| command create | `P10.11` counter-cash corrections | — | +20 / +21 |
| day update | `P10.11` | — | +13 / +14 † |
| transaction update | `P10.11` | — | +96 / +97 |
| command create | `P10.6` counter-cash undo | — | +31 / +32 |
| day update | `P10.6` | — | +39 / +40 † |

The tightest anchors are still the day rule for `CreateOrder` (+11) and the command rule for mutations and refunds (+19). Re-measure before adding checks to either.

### Mutants

Each mutant removes one P10a check from `firestore.rules` and runs all of `cloudTransactionMutation.spec.ts`. The first round left nine checks untested by raw SDK attacks (the repository refuses those inputs before Rules see them); `P10.25` and a stale-student-revision case in `P10.19` were added for them.

| Removed check | Result |
|---|---|
| `cashEffect` equals `mutationCashEffect` | killed (`P10.19`) |
| `command.reason == payload.reason` | killed (`P10.19`) |
| student balance `before − old + new` | killed (`P10.19`) |
| day totals `before − old + new` (8 keys) | killed (`P10.19`) |
| `CancelRefund`／`Undo` only for today's Taipei date | killed (`P10.25`) |
| Undo by the creator only | killed (`P10.22`) |
| Undo names the creating command (`lastCommandId == targetCommandId`) | killed (`P10.25`) |
| Undo fixed reason | killed (`P10.25`) |
| cancel only on orders | killed (`P10.22`) |
| a correction must change something | killed (`P10.25`) |
| a payment correction stays ≥ 1 | killed (`P10.25`) |
| a refund correction does not raise into debt | killed (`P10.25`) |
| keep-deposit clears the menu snapshots | killed (`P10.25`) |
| Undo requires revision 1 | survived: redundant. `lastCommandId == targetCommandId` already implies the row was written only by its create, since every mutation sets a new unique `lastCommandId`. |
| `txBefore.status == 'active'` in the command rule | survived: redundant with `before.status == 'active'` in the transaction update rule. |
| transaction revision bump in the command rule | survived: redundant. If the transaction write is omitted, `command.after.transaction` no longer equals `getAfter(transaction)` and the `cashEffect` check fails. |
| `expectedRevisions.student` in the command rule | survived: redundant with the same check in the student projection rule. |
| expense keeps its direction | survived, not isolated: under the mutant, the both-sides attacks in `P10.25` are still denied, but at the 1,000-expression cap on the deny path rather than by logic (the same caveat as the P05 negative cases). The legal counter-cash correction path has +20 on the command rule. |

The new Emulator suite against main's Rules fails 21 of 47 cases (RED); with the P10a Rules it passes 47/47.

### After merging P14 (`b33fc6b`)

`validCommandCreate` gains a last `RecordBackup` branch with the same `validRecordBackup(commandId, command, command.before.head, command.after.head)` arguments as main; `headCommand` keeps main's `RecordBackup` clause. Re-measured on the merged Rules:

| Rule anchor | Case | Main `b33fc6b` | P10a merged |
|---|---|---:|---:|
| command create | `P10.17` every kind, 500-char reason and note | — | +19 / +20 |
| dataHead update | `P10.17` | — | +95 / +96 |
| command create | `P10.12` refund corrections | — | +19 / +20 |
| command create | `P09b.9` refund, max payload | — | +19 / +20 |
| command create | `P08.8` CreateOrder | — | +20 / +21 |
| command create | P14 atomic `RecordBackup` receipt | — | +74 / +75 |
| dataHead update | P14 atomic `RecordBackup` receipt | — | +41 / +42 |
| command create | P14 `CreateStudent` writer integration | +2 / +4 | +3 / +4 |

The new P14 compatibility case (real P10a receipts through export and replay) is capped at **+3** on the command rule by its `CreateStudent` write. That limit already exists on main (+2 to +3, measured with the same probe on main's Rules), so it is not caused by P10a; the dispatch rewrite gives it one more term. Re-measure `CreateStudent` before adding any check to the command rule's earlier branches.

## P10b opening correction — budget and probe receipt

P10b enables `CorrectOpening` (F3). 20 kinds are enabled and 4 still denied (`CloseDay`, `ReopenDay`, `RecordExport`, `RecordPrint`). Contract: [P10b opening correction contract](../superpowers/specs/2026-10-17-cloud-opening-correction-contract.md).

### Write budget

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Read-but-unwritten dependencies | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|---:|
| `CorrectOpening` (command + dataHead + student + opening day) | commandHolder 2 + head before/after 2 + student before/after 2 + day before/after 2 = **8** | head 2 + student 2 + day 2 = **6** | lease `approvedOperator` **1** | **15/20** | **8/10** |

Static derivation from the read graph, the same method as the earlier appendices; the Emulator has no runtime access counter.

### Rule layout

- The command branch `validCorrectOpening` is the last branch of `validCommandCreate`, so every earlier kind keeps its headroom.
- The student check is a last branch of `studentWriteCommand` (`validStudentOpeningCorrection`). The `students` update key list gains `openingBalance`; every other branch already fixes its own changed keys.
- The day check has its **own `allow update`** on `days/{dayId}` (`dayOpeningCorrectionCommand`) instead of a new `dayWriteCommand` branch. A first version added a branch to `dayWriteCommand` and cost the existing `CreateOrder` day path one unit (+11 → +10, also with `CorrectOpening` folded into the kind list). With a separate `allow update`, `P08.8` and `P10.1` are back to +11, equal to main. The separate rule checks its own keys (`revision`, `lastCommandId`, `updatedAt`), the revision bump and `updatedAt`.

### Expression headroom

Same probe as before: inline `1 == 1 &&` terms at one rule anchor, bisected against a positive Emulator case.

| Rule anchor | Case | Main `95b7695` | P10b |
|---|---|---:|---:|
| command create | `P10b.7` max payload (500-char note and reason, −1e9) | — | +68 / +69 |
| student update | `P10b.7` | — | +83 / +84 |
| day update (`dayOpeningCorrectionCommand`) | `P10b.7` | — | +96 / +97 |
| dataHead update | `P10b.7` | — | +95 / +96 |
| day update (`dayWriteCommand`) | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| day update (`dayWriteCommand`) | `P10.1` order correction | +11 / +12 † | +11 / +12 † |
| command create | `P08.8` CreateOrder | +20 / +21 | +20 / +21 |
| command create | `P10.17` every mutation kind | +19 / +20 | +19 / +20 |
| command create | `P09b.9` refund, max payload | +19 / +20 | +19 / +20 |
| command create | P14 real P10a receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |
| command create | P14 real P10b receipt (capped by `CreateStudent`) | — | +3 / +4 |

† capped by the `CreateOrder` that the case runs first. Main values come from the P10a appendix, except `P08.8` day, re-measured on `95b7695` for this PR.

The tightest anchors are unchanged: the day rule for `CreateOrder` (+11), the command rule for mutations and refunds (+19), and `CreateStudent` on the command rule (+3).

### Mutants

Each mutant removes one P10b check from `firestore.rules` and runs all of `cloudOpeningCorrection.spec.ts`. The first round left five checks without a raw attack; four cases were added (opening unchanged, extra `before`／`after` projection, an identical twin day written by the same command).

| Removed check | Result |
|---|---|
| `asOfDate == dayId` (command) | killed (`P10b.10`) |
| zero cash effect | killed (`P10b.9`) |
| `reason == payload.reason` | killed (`P10b.9`) |
| `businessDate == dayId` | killed (`P10b.9`) |
| `studentId == targets.studentId` | killed (`P10b.9`) |
| reason 1–500 | killed (`P10b.9`) |
| payload exact keys | killed (`P10b.9`) |
| `expectedRevisions.day` | killed (`P10b.9`) |
| new opening object equals `{ amount, 原 asOfDate, note, 原 createdAt }` (student) | killed (`P10b.9`) |
| the opening must change (student) | killed (`P10b.9`) |
| balance `before − old opening + new opening` (student) | killed (`P10b.9`) |
| student changed keys (student) | killed (`P10b.9`) |
| day changed keys (day) | killed (`P10b.9`) |
| day target equals the written day (day) | killed (`P10b.10`) |
| `before`／`after` snapshot binding (command) | killed (`P10b.9`) |
| day open／reopened (command) | survived: redundant with the same check in the day rule (and the reverse). `P10b.4` covers a closed day with both in place. |
| note ≤ 500 (command) | survived: redundant with `validStudent` (opening note ≤ 500). |
| student／day revision bump (command) | survived: redundant with the `revision + 1` checks in the student and day rules. |

The new Emulator suite against main's Rules fails 8 of 42 cases (every positive path); the deny cases also pass on main because main denies every `CorrectOpening`. With the P10b Rules it passes 42/42.

## P11 day close — budget and probe receipt

P11a enables `CloseDay` and `ReopenDay`. 22 kinds are enabled and 2 still denied (`RecordExport`, `RecordPrint`). Contract: [P11 day close contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md).

### Write budget

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|
| `CloseDay`／`ReopenDay` (command + dataHead + day + settlement n) | commandHolder 2 (lease, operator) + head before/after 2 + day before/after 2 + settlement n−1 `get` 1 (only when n > 1) + settlement n `getAfter` 1 = **8** | head 2 + day (`getAfter` command, `exists` command) 2 + settlement (`getAfter` command, `exists` command) 2 = **6** | **14/20** | **8/10** |

Static derivation from the read graph, the same method as the earlier appendices; the Emulator has no runtime access counter.

### Rule layout

- The command check `validDaySettlementCommand` is nested inside the last operand of `validCommandCreate`, together with `CorrectOpening`: `|| ((kind == 'CorrectOpening' && …) || (kind in ['CloseDay', 'ReopenDay'] && …))`. A first version added a new top-level `||` operand. Even an operand that was only `kind in [...] && false` cost the mutation and refund cases one unit (`P10.17` and `P09b.9` +19 → +18), because every top-level `||` above an earlier kind's operand is counted. Nested, both are back to +19, equal to main. A conditional (`kind == 'CorrectOpening' ? … : …`) also kept +19, but the Emulator then answered a malformed `CloseDay` (`P07.2`, no `targets`) with a retryable error instead of a denial, so the client retried until the test timed out; the nested form denies it at once.
- The day check has its **own `allow update`** on `days/{dayId}` (`dayCloseCommand`), like P10b. It fixes the changed keys (`status`, `lastSettlementRevision`, `revision`, `lastCommandId`, `updatedAt`), the status transition and the +1 bumps. `P08.8` keeps +11 on the `dayWriteCommand` rule.
- Settlement versions have their own `match /days/{dayId}/settlements/{revision}`: create only through `settlementCreateCommand` (the whole 15-field document equals the map derived from the command and `before.day`), `update` and `delete` always false, `get`／`list` for the current holder.

### Expression headroom

Same probe as before: inline `1 == 1 &&` terms at one rule anchor, bisected against a positive Emulator case. Main is `32e90c6`.

| Rule anchor | Case | Main `32e90c6` | P11a |
|---|---|---:|---:|
| command create | `P11.9` max payload (counted 1e9, 500-char note, 500-char reopen reason) | — | +53 / +54 |
| dataHead update | `P11.9` | — | +95 / +96 |
| day update (`dayCloseCommand`) | `P11.9` | — | +96 / +97 |
| settlement create | `P11.9` | — | +96 / +97 |
| command create | `P11.7` reopen → correction → re-close (capped by the correction) | — | +20 / +21 |
| day update (`dayWriteCommand`) | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| command create | `P08.8` CreateOrder | +20 / +21 † | +20 / +21 |
| command create | `P10.17` every mutation kind | +19 / +20 | +19 / +20 |
| command create | `P09b.9` refund, max payload | +19 / +20 | +19 / +20 |
| command create | `P10b.7` CorrectOpening max payload | +68 / +69 † | +68 / +69 |
| command create | P14 atomic `RecordBackup` receipt | +74 / +75 | +74 / +75 |
| command create | P14 real P10a receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |
| command create | P14 real P11 receipts (capped by `CreateStudent`) | — | +3 / +4 |

† from the P10b appendix (`95b7695`); the Rules did not change between `95b7695` and `32e90c6`. The other main values were re-measured on `32e90c6` for this PR.

The tightest anchors are unchanged: the day rule for `CreateOrder` (+11), the command rule for mutations and refunds (+19), and `CreateStudent` on the command rule (+3).

### Mutants

Each mutant removes one P11 check from `firestore.rules` and runs all of `cloudDayClose.spec.ts`. The first round of 26 left nine checks alive; three were real gaps and got a raw attack each (a forged `payload.expectedCash` that equals the counted cash to skip the note, an extra key in the `ReopenDay` payload, an identical twin settlement at another path in the same batch). The other six are redundant with a check in another rule.

| Removed check | Result |
|---|---|
| `expectedRevisions.settlement == last` (command) | killed (`P11.10`) |
| `businessDate == dayId` (command) | killed (`P11.10`) |
| `studentId == null` (command) | killed (`P11.10`) |
| zero cash effect (command) | killed (`P11.10`) |
| CloseDay payload exact keys (command) | killed (`P11.10`) |
| `countedCash` 0..1e9 (command) | killed (`P11.10`) |
| note ≤ 500 (command) | killed (`P11.10`) |
| `payload.expectedCash` equals the §7.1 formula (command) | killed after round 2 (`P11.10` forged expected cash) |
| a difference needs a note (command) | killed (`P11.1`) |
| CloseDay `reason == null` (command) | killed (`P11.10`) |
| ReopenDay payload exact keys (command) | killed after round 2 (`P11.11` extra key) |
| reopen reason 1–500 (command) | killed (`P11.8`) |
| `reason == payload.reason` (command) | killed (`P11.11`) |
| `before` snapshot binding (command) | killed (`P11.10`, `P11.11`) |
| `after` snapshot binding (command) | killed (`P11.10`) |
| day after status (day) | killed (`P11.10`, `P11.11`) |
| day changed keys (day) | killed (`P11.10`) |
| day settlement pointer +1 (day) | killed (`P11.10`) |
| settlement path equals `targets.settlementRevision` (settlement) | killed after round 2 (`P11.12` twin version) |
| settlement whole map (settlement) | killed (`P11.10`, 11 cases) |
| `targets.settlementRevision == last + 1` (command) | survived: redundant with the settlement path check and the command's `getAfter` of version `last + 1`. |
| `validTaipeiDate(dayId)` (command) | survived: redundant; the day document must exist, and `EnsureDay` only creates valid dates. |
| CloseDay day open／reopened (command) | survived: redundant with the same check in the day rule (and the reverse). |
| ReopenDay day closed (command) | survived: redundant with the day rule (and the reverse). |
| `openingCash is int` (command) | survived: redundant; with a null `openingCash` the §7.1 formula errors and the rule denies. `P11.3` covers it through the writer. |
| day before status (day) | survived: redundant with the command rule (and the reverse). |

The new Emulator suite (48 cases) against main's Rules fails 16 (every positive path); the deny cases also pass on main because main denies every `CloseDay`／`ReopenDay`. With the P11a Rules it passes 48/48.

## P11 backfill opening — budget and probe receipt

CheerC (2026-10-17) asked for a way to backfill a past day's opening cash and then close it, so a network outage cannot leave a day permanently unclosable. `BackfillOpeningCash` is a new kind: 25 kinds, 23 enabled, `RecordExport` and `RecordPrint` still denied. Contract: [P11 day close contract §10](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#10-補開帳backfillopeningcash).

### Write budget

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|
| `BackfillOpeningCash` (command + dataHead + day) | commandHolder 2 (lease, operator) + head before/after 2 + day before/after 2 = **6** | head 2 + day (`getAfter` command, `exists` command) 2 = **4** | **10/20** | **6/10** |

Static derivation from the read graph, the same method as the earlier appendices.

### Rule layout

- The command check `validBackfillOpeningCash` is nested inside the last operand of `validCommandCreate`, next to `CloseDay`／`ReopenDay`, so earlier kinds keep their headroom (see the P11 appendix for why a new top-level `||` operand costs them).
- The day check is a **third, separate `allow update`** on `days/{dayId}` (`dayBackfillOpeningCommand`). It fixes the changed keys (`openingCash`, `openedBy`, `openedAt`, `revision`, `lastCommandId`, `updatedAt`), requires the three opening fields to be null before, binds `openedBy` to the caller and `openedAt` to `request.time`. `SetOpeningCash` and every transaction rule are unchanged, so they still only accept the Taipei today.
- "Before the Taipei today" is `timestamp(dayId 00:00Z) + 24h <= request.time + 8h`.

### Expression headroom

Same probe: inline `1 == 1 &&` terms at one anchor, bisected against a positive Emulator case. Main is `71ee1bc` (Rules identical to `91b5909`, so main values are from the P11 appendix).

| Rule anchor | Case | Main | This PR |
|---|---|---:|---:|
| command create | `P11.17` backfill max payload (20,000, 500-char reason) | — | +70 / +71 |
| dataHead update | `P11.17` | — | +95 / +96 |
| day update (`dayBackfillOpeningCommand`) | `P11.17` | — | +96 / +97 |
| command create | P14 real `BackfillOpeningCash` receipts (EnsureDay → backfill → close) | — | +34 / +35 |
| command create | `P11.9` CloseDay／ReopenDay max payload | +53 / +54 | +53 / +54 |
| dataHead update | `P11.9` | +95 / +96 | +95 / +96 |
| day update (`dayCloseCommand`) | `P11.9` | +96 / +97 | +96 / +97 |
| settlement create | `P11.9` | +96 / +97 | +96 / +97 |
| command create | `P11.7` reopen → correction → re-close | +20 / +21 | +20 / +21 |
| day update (`dayWriteCommand`) | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| command create | `P08.8` CreateOrder | +20 / +21 | +20 / +21 |
| command create | `P10.17` every mutation kind | +19 / +20 | +19 / +20 |
| command create | `P09b.9` refund, max payload | +19 / +20 | +19 / +20 |
| command create | `P10b.7` CorrectOpening max payload | +68 / +69 | +68 / +69 |
| command create | P14 atomic `RecordBackup` receipt | +74 / +75 | +74 / +75 |
| command create | P14 real P10a receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |
| command create | P14 real P11 receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |

Every existing anchor is unchanged. The tightest are still the day rule for `CreateOrder` (+11), the command rule for mutations and refunds (+19), and `CreateStudent` on the command rule (+3).

### Mutants

Each mutant removes one check from `firestore.rules` and runs all of `cloudDayClose.spec.ts` (76 cases).

| Removed check | Result |
|---|---|
| holder／envelope (`commandHolder`, `cashCommandEnvelope`) (command) | killed (`P11.17`, operatorB self-signed raw batch) |
| day before today (command) | killed (`P11.19`) |
| `dayId >= goLiveDate` (command) | killed (`P11.19`) |
| `openingCash` 0..20,000 (command) | killed (`P11.18`) |
| `validMutationReason(reason)` (command) | killed (`P11.18`) |
| `command.reason == payload.reason` (command) | killed (`P11.18`) |
| `after.openingCash == payload.openingCash` (day) | killed (`P11.18`) |
| `openedBy`／`openedAt` bound to caller and time (day) | killed (`P11.18`) |
| day changed keys (day) | killed (`P11.18`) |
| status open／reopened in **both** rules | killed (`P11.19`) |
| opening fields null in **both** rules | killed (`P11.19`) |
| status open／reopened (command only, or day only) | survived: redundant with the same check in the other rule. |
| opening fields null (command only, or day only) | survived: redundant with the same check in the other rule. |

## P11c1 — SetOpeningCash optional reason — budget and probe receipt

P11c1 changes one Rules function, `validSetOpeningCash`: the payload may carry an optional `reason` (1–500 characters) when the opening cash differs from the last closed day's counted cash. Kind count is unchanged (25 kinds, 23 enabled). Contract: [P11 day close contract §11](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#11-p11c1-帳務異常與開帳差額原因). The ledger reads are client-side server reads and add no Rules paths.

### Rule layout

- `validSetOpeningCash` accepts exactly two shapes: payload `{openingCash}` with command `reason == null`, or payload `{openingCash, reason}` with `validMutationReason(reason)` and `command.reason == payload.reason`.
- It now calls `cashCommandEnvelope` instead of `p07CommandEnvelope`. `p07CommandEnvelope` fixes the command `reason` to null for every kind except `RemoveVendor`, so a reason could never pass it. `cashCommandEnvelope` is the same envelope without that reason clause (already used by the cash, refund, backfill kinds); the reason is bound by `validSetOpeningCash` itself. `p07CommandEnvelope` is unchanged, so `SaveVendor`, `RemoveVendor` and `SetDayMenu` are untouched.
- No new top-level `||` in `validCommandCreate`; `dayWriteCommand`, `validDayOpeningCashProjection` and the day fields are unchanged (the day stores no reason).
- "A difference needs a reason" is enforced by the screen and the writer, not by Rules (Rules cannot know the last closed day).

### Write budget

Unchanged from the P07 `SetOpeningCash` row: command + dataHead + day, no new reads.

### Expression headroom

Same probe as earlier appendices (`1 == 1 &&` terms at one anchor, bisected against a positive Emulator case; main `8cd8dc3`). Main cannot run the reason case, so main is measured with the plain maximum (`P11c1.7`, 650) and this PR with both the plain case and the legal maximum (`P11c1.8`: 20,000 and a 500-character reason).

| Rule anchor | Case | Main | This PR |
|---|---|---:|---:|
| command create | `P11c1.7` plain SetOpeningCash | +68 / +69 | +70 / +71 |
| dataHead update | `P11c1.7` | +95 / +96 | +95 / +96 |
| day update (`dayWriteCommand`) | `P11c1.7` | +80 / +81 | +80 / +81 |
| command create | `P11c1.8` max reason payload | — | +62 / +63 |
| dataHead update | `P11c1.8` | — | +95 / +96 |
| day update (`dayWriteCommand`) | `P11c1.8` | — | +80 / +81 |
| day update (`dayWriteCommand`) | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| command create | `P10.17` every mutation kind | +19 / +20 | +19 / +20 |
| command create | `P09b.9` refund, max payload | +19 / +20 | +19 / +20 |
| command create | P14 real P10a receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |

The plain path gains two units because `cashCommandEnvelope` has no reason ternary. No existing anchor dropped; the tightest are unchanged (day rule for `CreateOrder` +11, command rule for mutations and refunds +19, `CreateStudent` +3). The earlier values of the other anchors are in the P11 appendices (same Rules outside `validSetOpeningCash`).

### Mutants

Each mutant changes one check in `validSetOpeningCash` and runs `cloudDayClose.spec.ts -t P11c1` (20 cases).

| Mutant | Result |
|---|---|
| remove `validMutationReason(payload.reason)` | killed (4 cases: empty, 501, not a string, null) |
| remove `command.reason == payload.reason` | killed (2 cases: differs, null with payload reason) |
| plain shape without `command.reason == null` | killed (1 case: command reason set without payload reason) |
| reason shape without exact keys `['openingCash','reason']` | killed (1 case: extra key) |
| plain shape without exact keys `['openingCash']` | killed (3 cases) |


## P11c2a — gap-day backfill — budget and probe receipt

P11c2a adds the 26th kind `StartBackfill` (24 enabled) and the new collection `backfillDays/{dayId}`, and lets `CreateOrder`, `CreatePayment` and `CreateCashMovement` land on a marked past day. Contract: [P11 day close contract §12](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#12-p11c2a-回填斷層日startbackfill).

### Rule layout

- `validTransactionDay(dayId, day)` = `validCurrentTaipeiDate(dayId) || (day.lastSettlementRevision == 0 && exists(backfillDays/dayId))`. It replaces `validCurrentTaipeiDate` in four places: `validTransactionDoc` (`tx.businessDate`), `validCreateCashMovement` (command path and transaction path) and the `transactionCommand` CreateCashMovement branch. `day` is the before-snapshot those paths already read, so there is no extra `get`. Today's writes short-circuit on the first operand and pay no extra document access.
- `validTransactionPayload` used to check the same date a second time (`command.targets.dayId`). `validTransactionDoc`, called from the same function, already pins `tx.businessDate == command.targets.dayId` and checks the day, so that second check was removed as a pure duplicate (no check was weakened). It cost 14 expressions on the backfill path and 9 on the today path.
- `validStartBackfill` is nested in the last operand of `validCommandCreate` next to `CloseDay` and `BackfillOpeningCash` (no new top-level `||`). `backfillDays/{dayId}`: `get`/`list` for the current holder, `update`/`delete` false, `create` only through `backfillDayCommand`. `dayWriteCommand` is untouched; `CreateRefund`, `Undo`, `CancelRefund` stay today-only.
- Write budget of `StartBackfill`: command + dataHead + `backfillDays` = 3 writes, reads: head, day, lease/operator like `BackfillOpeningCash` plus one `getAfter`/`exists` on the marker. The backfill order/payment/cash positive cases (`P11c2a.4`, `P11c2a.14`) pass in the Emulator, i.e. stay within the 10 accesses per request and 20 per batch.

### Expression headroom

Same probe as earlier appendices (`1 == 1 &&` terms at one anchor, bisected against a positive Emulator case; `+lo / +hi`). Main is `fb2fc11`; this PR's measurements for the transaction anchors were taken after removing the duplicate date check (before it, the order transaction anchor was +32 on a today order and +2 on a backfill order). The probe has a new anchor `backfill` (the `backfillDays` create rule).

| Rule anchor | Case | Main | This PR |
|---|---|---:|---:|
| day update (`dayWriteCommand`) | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| command create | `P08.8` CreateOrder | +20 / +21 | +20 / +21 |
| transaction create | `P08.8` CreateOrder | +34 / +35 | +43 / +44 |
| dataHead update | `P08.8` | +95 / +96 | +95 / +96 |
| command create | `P07.8` SetDayMenu direct | +19 / +20 | +19 / +20 |
| command create | `P09.8` CreateCashMovement | +30 / +31 | +29 / +30 |
| transaction create | `P09.8` CreateCashMovement | +95 / +96 | +95 / +96 |
| command create | `P09b.9` refund, max payload | +19 / +20 | +19 / +20 |
| transaction create | `P09b.9` refund | +95 / +96 | +95 / +96 |
| command create | `P10.17` every mutation kind | +19 / +20 | +19 / +20 |
| command create | P14 real P10a receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |
| command create | `P11c2a.14` backfilled order | — | +20 / +21 |
| transaction create | `P11c2a.14` backfilled order | — | +16 / +17 |
| day update (`dayWriteCommand`) | `P11c2a.14` backfilled order | — | +11 / +12 |
| dataHead update | `P11c2a.14` backfilled order | — | +95 / +96 |
| command create | `P11c2a.14` backfilled payment | — | +20 / +21 |
| transaction create | `P11c2a.14` backfilled payment | — | +57 / +58 |
| command create | `P11c2a.14` backfilled cash movement | — | +29 / +30 |
| transaction create | `P11c2a.14` backfilled cash movement | — | +95 / +96 |
| command create | `P11c2a.8` `StartBackfill`, 500-character reason | — | +69 / +70 |
| dataHead update | `P11c2a.8` | — | +95 / +96 |
| `backfillDays` create | `P11c2a.8` | — | +96 / +97 |

No existing anchor dropped by more than 1 (cash command +30 → +29); the tightest are unchanged: day rule for `CreateOrder` +11, command rules for mutations and refunds +19, `CreateStudent` +3. The tightest new path is the backfilled order transaction create at +16.

### Mutants

Each mutant changes one check and runs `cloudDayClose.spec.ts -t P11c2a` (36 cases).

| Mutant | Result |
|---|---|
| remove `day.lastSettlementRevision == 0` from `validTransactionDay` | killed (`P11c2a.7`: reopened-after-close day accepts a backfilled transaction) |
| remove `dayBefore.lastSettlementRevision == 0` from `validStartBackfill` | killed (`P11c2a.10`) |
| remove `exists(backfillDays/…)` from `validTransactionDay` | killed (`P11c2a.5`: unmarked past day accepts transactions) |
| `backfillDays` `update, delete` allowed for the holder | killed (`P11c2a.11`) |
| `validStartBackfill` without the "before Taipei today" check | killed (`P11c2a.10`: marks today) |
| marker `reason` no longer bound to the payload reason | killed (`P11c2a.9`) |

One check is deliberately not a mutant: `!exists(backfillDays/…)` in `validStartBackfill`. A second marker for the same day is a `create` on an existing document, which Firestore evaluates as an `update` and the `update` rule denies, so removing the check cannot change behaviour.

## P11c3 — aligned close of a back-filled day — budget and probe receipt

P11c3 changes two Rules functions and adds no kind (26 kinds, 24 enabled) and no collection. A `CloseDay` on a marked day (`backfillDays/{dayId}` present) must carry `alignWithDayId` and close with no difference; an ordinary close is unchanged. Contract: [P11 day close contract §14](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#14-p11c3-回填日關帳對齊).

### Rule layout

- `validDaySettlementCommand` (command rule, the tight one): the close branch accepts either the old three-key payload (checked first, so an ordinary close short-circuits) or the four-key payload `{countedCash, note, expectedCash, alignWithDayId}` with `countedCash == expectedCash` and `alignWithDayId == null || (validTaipeiDate && > dayId && get(days/alignWithDayId).openingCash == countedCash)`. It does not look at the marker.
- `dayCloseCommand` (day rule, +96 headroom): for a close, `('alignWithDayId' in command.payload) == exists(backfillDays/dayId)`. The command, the day update and the settlement version commit in one batch and the day update must pass this rule, so the link between marker and payload shape is enforced atomically without spending command-rule headroom. A first version put `exists(marker)` in the command rule: it cost three units there (P11.9 command rule +53 → +50, the P11c3.8 case +37), which is why it moved.
- Rules cannot prove that no nearer opened day exists, or that `null` really means none; the writer scans (`findNextOpened`) and the anomaly page stays the safety net (contract §14.2). `validTaipeiDate(alignWithDayId)` is a redundant guard: `days/` only holds date IDs and a `get` on any other path denies.

### Write budget

| Command / write path | Central command-create Rules calls | Projection leaves Rules calls | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|
| `CloseDay` on an ordinary day (n > 1) | 8 (unchanged) | head 2 + day 3 (`getAfter`, `exists` command, `exists` marker) + settlement 2 = 7 | **15/20** | **8/10** |
| `CloseDay` on a marked day with a dated alignment (n > 1) | 8 + `get days/alignWithDayId` 1 = **9** | 7 | **16/20** | **9/10** |

Static derivation like the earlier appendices (the Emulator has no access counter). The busiest path — a marked day closed, reopened and closed again (`P11c3.10`, settlement n = 3 and then 5) — passes in the Emulator for the repository and for a raw batch.

### Expression headroom

Same probe as before (`1 == 1 &&` terms at one anchor, bisected against a positive Emulator case; `+lo / +hi`). Main is `797b23e` (same Rules as `5fd45a0`); this PR is measured on its final Rules. The existing anchors from the instruction were all measured on both sides; none dropped to +5 or lower, and none is more than 3 below main.

| Rule anchor | Case | Main | This PR |
|---|---|---:|---:|
| command create | `P11.9` ordinary max close | +53 / +54 | +52 / +53 |
| dataHead update | `P11.9` | +95 / +96 | +95 / +96 |
| day update (`dayCloseCommand`) | `P11.9` | +96 / +97 | +96 / +97 |
| settlement create | `P11.9` | +96 / +97 | +96 / +97 |
| day update (`dayWriteCommand`) | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| command create | `P08.8` CreateOrder | +20 / +21 | +20 / +21 |
| command create | P14 real P10a receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |
| transaction create | `P11c2a.14` backfilled order | +16 / +17 | +16 / +17 |
| command create | `P11c3.8` aligned max close (500-character note, opening 20,000) | — | +36 / +37 |
| dataHead update | `P11c3.8` | — | +95 / +96 |
| day update (`dayCloseCommand`) | `P11c3.8` | — | +96 / +97 |
| settlement create | `P11c3.8` | — | +96 / +97 |
| command create | `P11c3.10` reclose of a reopened marked day (capped by the backfilled payment, not `CloseDay`) | — | +20 / +21 |
| day update (`dayCloseCommand`) | `P11c3.10` | — | +96 / +97 |

The tightest anchors are unchanged: the transaction rule for a backfilled order (+16), the day rule for `CreateOrder` (+11), `CreateStudent` on the command rule (+3). The only anchor that moved is the command rule on an ordinary close (−1, the extra `||` operand); the aligned close has +36.

### Mutants

Each Rules mutant changes one check and runs `cloudDayClose.spec.ts -t 'P11c3|P11.9|P11.1:|P11c2a.4'` (24 cases). Writer and backup mutants run `P11c3` and `aligned close`.

| Mutant | Result |
|---|---|
| remove `countedCash == expectedCash` from the aligned branch | killed (`P11c3.7`: difference with a matching alignment and with a null alignment; the first version of the test was too weak and let this survive, now each case isolates the check) |
| alignment day only has to exist (no `openingCash == countedCash`) | killed (`P11c3.7` amount mismatch and unopened day) |
| remove `alignWithDayId > dayId` | killed (`P11c3.7` earlier day with the same opening cash; self alignment) |
| an unopened alignment day (`openingCash == null`) also passes | killed (`P11c3.7` alignment day has no confirmed opening cash) |
| remove the marker link in `dayCloseCommand` | killed (`P11c3.7` ordinary day with the key, marked day without it) |
| marked day may omit `alignWithDayId` | killed |
| unmarked day may carry `alignWithDayId` | killed |
| `validTaipeiDate(alignWithDayId)` → `is string` | **equivalent**: a path-like or junk string only reaches a `get` on a path that does not exist and denies (`P11c3.7` path case stays denied) |
| writer: skip the nearest-opened-day comparison | killed (`P11c3.3`) |
| backup replay: do not compare the aligned day's opening cash | killed (`aligned close`: coherent forgery of the aligned day's opening) |
| backup replay: allow `alignWithDayId` on an unmarked day | killed (`aligned close`) |
| backup replay: drop `align > dayId` | **equivalent**: `normalizeEnabledCommandInput` rejects it first (the payload schema, §14.5) |

## P11c4a — post-close entry — budget and probe receipt

P11c4a adds the 27th kind `RecordPostCloseEntry` (25 enabled) and the new collection `postCloseEntries/{entryId}` (entry ID = command ID). It writes the data head, the command and one immutable entry; the day document, settlements, transactions and students are not written. Contract: [P11 day close contract §15](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#15-p11c4-關帳後補記recordpostcloseentry).

### Rule layout

- `validRecordPostCloseEntry` is nested in the last operand of `validCommandCreate` next to `StartBackfill` (no new top-level `||`). It binds `expectedRevisions.day` to `dayBefore.revision` and `expectedRevisions.settlement` to `dayBefore.lastSettlementRevision`, requires `dayBefore.status == 'closed'` and `dayId >= goLiveDate`, restricts the payload to `{direction, amount 1–20,000, reason}`, and uses `p.reason.trim().size() >= 1` (Rules Emulator trim removes ASCII U+0000–U+0020) alongside `validMutationReason`. It ties the top-level `reason` to `payload.reason` and pins `before = {head, day, postCloseEntry: null}` and `after = {headAfter, day (unchanged), entry}` with `entry` an exact map (`entryId == commandId`, `settlementRevision == dayBefore.lastSettlementRevision`, `createdBy == auth.uid`, `createdAt == request.time`).
- `postCloseEntries/{entryId}`: `get`/`list` for the current holder, `update`/`delete` false, `create` only through `postCloseEntryCommand` (the command exists after the commit, did not exist before, has the same ID, kind and commit time, and its `after.postCloseEntry` equals the written entry). The head rule is kind-agnostic, so `headCommand` is untouched. `dayWriteCommand`, `dayCloseCommand` and `StartBackfill` are untouched.

### Write budget

| Command / write path | Command-create Rules calls | Head leaf | Entry leaf | Atomic no-cache total | Max per write |
|---|---:|---:|---:|---:|---:|
| `RecordPostCloseEntry` | 6 (`get` lease, `get` operator, `get` head, `getAfter` head, `get` day, `getAfter` entry) | 2 (`getAfter` + `exists` command) | 2 (`getAfter` + `exists` command) | **10 (+1 lease verify) = 11/20** | **6/10** |

Static derivation like the earlier appendices (the Emulator has no access counter). It is the same shape as `StartBackfill`; the maximum payload (`P11c4.3`: amount 20,000, 500-character reason) and a raw batch pass in the Emulator.

### Expression headroom

Same probe as before (`1 == 1 &&` terms at one anchor, bisected against a positive Emulator case; `+lo / +hi`). Main is `e824492`; the table records the source implementation report on final Rules head `5a3bd17` (`firestore.rules` unchanged since the first Rules commit `d010464`). That report measured each listed anchor on both sides and records the existing anchors equal to main. The later independent review on the same head reran a separate 9-anchor set; it did not claim to reproduce every row in this table (see the review receipt in [evidence](free-production-evidence.md#p11c4a-關帳後補記-checkpoint--2026-10-18)).

| Rule anchor | Case | Main | This PR |
|---|---|---:|---:|
| command create | `P11.9` ordinary max close | +52 / +53 | +52 / +53 |
| dataHead update | `P11.9` | +95 / +96 | +95 / +96 |
| day update (`dayCloseCommand`) | `P11.9` | +96 / +97 | +96 / +97 |
| settlement create | `P11.9` | +96 / +97 | +96 / +97 |
| day update (`dayWriteCommand`) | `P08.8` CreateOrder | +11 / +12 | +11 / +12 |
| command create | `P08.8` CreateOrder | +20 / +21 | +20 / +21 |
| command create | P14 real P10a receipts (capped by `CreateStudent`) | +3 / +4 | +3 / +4 |
| transaction create | `P11c2a.14` backfilled order | +16 / +17 | +16 / +17 |
| command create | `P11c3.8` aligned max close | +36 / +37 | +36 / +37 |
| command create | `P11c3.10` reclose of a reopened marked day | +20 / +21 | +20 / +21 |
| command create | `P11c4.3` `RecordPostCloseEntry`, 20,000 and a 500-character reason | — | +64 / +65 |
| dataHead update | `P11c4.3` | — | +95 / +96 |
| `postCloseEntries` create | `P11c4.3` | — | +96 / +97 |

Review fix (`reason.trim().size() >= 1` on the command rule): in the source implementation report, the new kind's command anchor moved from +65 / +66 to +64 / +65; every other listed anchor is unchanged. Rules Emulator `trim()` removes ASCII U+0000–U+0020, including control characters. The client normalizer rejects an empty string and reasons made only of space, tab, CR or LF; it may accept other ASCII control-only reasons that Rules then rejects, so the two accepted sets are not identical. Unicode whitespace-only reasons (for example U+3000 and U+00A0) pass Rules and must remain accepted by receipt, entry reads and backup validation; otherwise an immutable value Rules accepted could block later reads or exports. The backup manifest validates the raw 1–500 length and equality without a stricter whitespace check.

The independent reviewer on source head `5a3bd17` ran `probe.py` for 9 candidate anchors (18 lo／hi points) and `probe-base.py` for the 3 tightest base anchors (6 points). The reviewer explicitly confirmed base／candidate equality for `CreateStudent`, P08.8 dayWrite and the backfilled-order transaction; other source-table rows were not re-probed in that review. For the new head and entry anchors, the upper side reported “Expression is too complex to evaluate safely”; this is a compile-time expression limit, not a measured runtime 1,000-expression ceiling.

The tightest anchors are unchanged: the transaction rule for a backfilled order (+16), the day rule for `CreateOrder` (+11), `CreateStudent` on the command rule (+3). The new kind has +64 on the command rule.

### Mutants

Each Rules mutant changes one check in `validRecordPostCloseEntry` / `postCloseEntryCommand` / the `postCloseEntries` rule and runs `cloudDayClose.spec.ts -t P11c4` (all `P11c4.*` cases). Backup mutants run the `post-close entry` round-trip in `cloudBackup.spec.ts`.

| Mutant | Result |
|---|---|
| remove `dayBefore.status == 'closed'` | killed (`P11c4.5`: open and reopened days) |
| entry `settlementRevision` no longer bound to `dayBefore.lastSettlementRevision` | killed (`P11c4.4`: entry names another settlement revision) |
| remove `expectedRevisions.settlement == dayBefore.lastSettlementRevision` | killed (`P11c4.4`: stale expected settlement revision) |
| `postCloseEntries` `update, delete` allowed for the holder | killed (`P11c4.6`) |
| top-level `reason` no longer bound to `payload.reason` | killed (`P11c4.4`: a different reason and a `null` reason) |
| remove the 20,000 upper bound | killed (`P11c4.4`) |
| remove the `direction` check | killed (`P11c4.4`) |
| remove the `before == {head, day, postCloseEntry: null}` pin | killed (`P11c4.4`: before-snapshot claims an existing entry) |
| remove `dayId >= head.goLiveDate` | killed (`P11c4.5`) |
| `postCloseEntries` create without `postCloseEntryCommand` | killed (`P11c4.6`: hand-made entry) |
| remove `p.reason.trim().size() >= 1` (added after the independent review: a spaces-only reason passed Rules but made the backup export fail forever) | killed (`P11c4.4`: reason only spaces / only a tab and a newline) |
| remove `entryId == commandId` in `postCloseEntryCommand` | **survived the first test set** (every case moved or omitted the real entry); a copy of the entry under a second ID would be counted twice by the effective closing cash. Test added in `P11c4.5` (a copy next to the real entry, and the only copy under another ID) → killed |
| backup replay: drop the "day is closed" check | first run survived (a chain-consistent forgery was not tested); replay-level cases against a base state added (`post-close entry` test: open day, re-closed day) → killed |
| backup replay: drop `lastSettlementRevision == entry.settlementRevision` | same → killed |
| backup replay: drop "the entry does not exist yet" | **equivalent**: the projection loop already compares `before.postCloseEntry` (`null`) with the replayed state and rejects a repeat |
| backup manifest checks, one at a time: amount, settlement revision, day unchanged, day closed, top-level reason, go-live | survive individually, **by design**: `validateEnabledReceiptSemantics` (`validatePostCloseEntryReceipt`) and the replay's before-snapshot comparison reject the same forgeries. With the amount and settlement-revision checks removed from every layer the test fails (killed); the other four were only removed from the manifest and receipt layers, where a remaining shared check still rejects them |

The first column of mutants ran with `EASYORDER_TEST_RULES_PATH` pointing at a mutated copy of `firestore.rules` and `cloudDayClose.spec.ts -t P11c4`; backup mutants edited `cloudBackup.ts` / `cloudCommandSchema.ts` temporarily (restored after each run) and ran `cloudBackup.spec.ts -t 'post-close entry'`.
