# P12c PR #525 rework dispatch

Owner：coordinator。狀態：已派工。PR [#525](https://github.com/cheerc/talented-easyorder/pull/525)，base `3d49c8f267d1a15b5b036d899d38fa7bdcd5ab93`、待修 source `2b89d1ccb4e84b4a8df144790c7370c14fb40e2f`，branch `codex/p12c-report-ui`。獨立 COMMENT [5568149846](https://github.com/cheerc/talented-easyorder/pull/525#pullrequestreview-5568149846) REWORK：三項必修。Coordinator 已讀實際 code、review 與 print computed-style evidence，全部採納。Impl 不自行寫 plan 或改 scope，依本 brief 修同一 PR，不先 rebase／merge。

## R1：完整真實列印

`CloudReportPage.css` print rule 的 specificity 使 print article/td 仍 hidden；只修可見性仍因 fixed/overflow:auto 截為一頁。改為 print-media 下只呈現這次 frozen print surface，正常 flow 跨頁，不受螢幕分頁、捲動、固定高度／fixed viewport 裁切。正常螢幕仍隱藏 print surface，header/表格有可讀布局，不能讓非輸出畫面或其他帳戶內容出現在 PDF。

RED→GREEN：保留舊 CSS 會生成空白／不完整 PDF 的反證。正式 browser case 使用實際頁面、source CSS 與 frozen 204+ rows print surface，保留 RecordPrint receipt 前不發起、receipt 後只發起一次；另外以 Chromium `page.pdf`／print media 產生實際 PDF。驗證大於1頁、所有 expected row IDs（含首末列）均在實際 PDF text 出現，順序與模型相符；只數 DOM 或 stub window.print 不足。驗原始及合併模式：合併列按其 transactionIds 身分完整比對，別用原始列數硬套。印出 range/scope/H，避免正常頁面 UI 混入。

PDF parsing 採已驗本機可用的 Poppler `pdftotext`／`pdfinfo`（child_process execFile，無 shell 拼接資料）；required CI 兩個 E2E workflows 以系統套件 `poppler-utils` 明確 provision。不新增 PDF parser 生產相依，也不依賴本機偶然存在的工具；若工具缺失明確 fail，不能 skip。保留 PDF/text/JSON/trace 至 test output，供 reviewer 重驗。此處只需 read/verify PDF，不改產品 PDF 輸出介面。

## R2：action lifecycle／權限範圍

將 recordAction、recoverAction 的整段非同步流程綁 mount 與當時 identityKey／leaseEpoch 的 action generation/token；每次 await 成功、失敗、finally、重試前都確認仍屬當前有效 owner。unmount／身份或 epoch 變更立即使舊 token 失效，無論舊 Promise 最後 success/error 均不得 anchor.click、window.print、setState 或向新畫面發舊導航 resolved/revoked。既有讀取 generation 不可錯當 action generation。

保留 unknown recovery 的原 command ID/kind/identity/epoch 與必要 frozen intent；不換ID、不默默重送舊內容、不把已確認但過期callback標成已發起。失權後不能從舊內容自動輸出；只有重新有效且相符的 owner/context、明確 recovery/確認才可依原命令處理。暫存 recovery descriptor 不渲染敏感 CSV／print／draft，不能為本次修復新增本機帳務持久化或 P13。

RED→GREEN 覆蓋 export/print × record/recovery：deferred success 在 unmount、identity切換、epoch改變後不輸出且不發舊nav；late reject/catch/finally亦不汙染新畫面。至少保留 reviewer 的 unmount→success anchor.click=0 失敗案例為持久回歸。正常 mounted matched-owner immediate/delayed receipt 仍只發起一次；unknown查無receipt同ID重試，收到原receipt後一次；StrictMode/連按不重複。範圍／scope／mode切換鎖與 frozen H/intent 保持。不要把 guard 寫成永久禁止所有輸出。

## R3：F5 read denial 的完整清除

bootstrap、account/report/audit/list query、mutation、recovery 任一路徑遇 LEASE_LOST／UNAUTHORIZED，都採相同失權處理：立即失效舊 generation，清 snapshot、students、search、selected scope、未提交 draft／reason／金額／候選／相關表單及可渲染敏感 action內容，保留安全的中文錯誤與 revoked nav lock。不能只在 mutation denial 清除。已 pending 的 command 只留最小且不可渲染的 recovery 身分，未提交 draft 必須丟棄；後到的成功查詢不能把資料重新填回 revoked UI。

RED→GREEN：開歷史更正、填 private reason/amount、搜尋現名/aliases出候選，再對重新讀取注入兩種拒絕，草稿/理由/金額/學生姓名與候選都消失，nav revoked；後到成功的其他 Promise 也不能恢復。另測bootstrap與mutation/recovery拒絕一致。正常可恢復讀取的網路/資料衝突錯誤不一律當失權。P3 非阻擋提醒順手最小改名：lastCommandId 標「最後修改命令」，不新增猜測的建立命令映射。

## 補齊驗收界線與驗證

- 新回歸以實際 observable behavior 為準，不只測 token helper 或 CSS字串。引用 reviewer 外部失敗 probes 可復用為持久 test，不改弱其斷言。
- 原 R01 只驗 original/單帳戶部分；新增至少兩帳戶的 selected-scope、original/merged UI→CSV→實際 PDF 一致性斷言，確保合併/搜尋候選不暗改 scope，日摘要仍全日。可在同一 synthetic browser fixture 內擴充，不另開多個高成本200筆fixture。
- 保留 reader bounded null-date、nanos只讀fixture與合法主L07 mutation/後日settlement不變、P12b backup/unknown等既有契約，產品 Rules/indexes/command kinds本次不改。
- 先 focused regression RED→GREEN、再 affected component/domain/App、reader/backup/actions serial、完整 unit/lint/build/rootTSC、exact pinned-base App TSC完整normalized零新增、完整 legacy→P12c→prototype E2E。CLI telemetry用暫存 XDG config，不改全域偏好。原功能未變的舊Rules anchor不重做；不得加retry／timeout掩蓋失敗。
- 數字、原始 PDF／text／JSON／trace／log 與實際revision各自對應。review、impl、provider CI證據分開；舊review REWORK及舊headCI保留歷史，不能稱原始2/2證成完整列印。App208 inherited非cleanpass。

## 交付

修同一PR、中文commit與description，更新 evidence／當前狀態／docs-check，保留原P12c brief與coordinator addenda及本brief。Current PR仍待獨立複審/CI/合併；P12未完成、未部署、不進P13。push後主動報 final full head/base、URL、實測與raw artifact，停止寫入。Coordinator固定新head派Sol獨立重驗R1/R2/R3，另做delta adversarial review；review+requiredCI全綠才merge，mainCI及最終收據未完成前不能報P12完成。

## 本案 workflow authority（Coordinator 明確調整）

本批流程依人類在 coordinator chat 的直接授權（coordinator 寫 plan／dispatch、impl 實作、獨立 reviewer 審查，迭代至 P12 完成），以及 repository 適用指引、本 P12c dispatch/rework brief 執行。不可取得的外部 `impl-task-loop`／`team-workflow-map` 不是本案新增的批准 gate，也不引用其他 issue 拷貝作為權威。Coordinator 在既有授權範圍明確解除因此缺少外部 map 所造成的實作停止；不擴張生產部署、P13、秘密資料或未授權操作。實作者可立即依本 brief RED→GREEN，後續由同一 reviewer 對新 head 獨立審查。這是本次派工的流程界定，不修改常駐技能或其他工作規則。
