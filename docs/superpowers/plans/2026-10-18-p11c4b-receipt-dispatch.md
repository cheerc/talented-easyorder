# P11c4b 收據 dispatch brief

Owner：coordinator。狀態：已派工準備，待 main CI 綠燈才發布。Pinned base／#519 merge SHA：`855679804a12cd1bce5dce72fe2da20127e2c85d`；最終 source：`340726ff4b14343e4542eaa3bd936ede50fbfa0e`；原 REWORK review [5563425902](https://github.com/cheerc/talented-easyorder/pull/519#pullrequestreview-5563425902)，新 head PASS [5563479986](https://github.com/cheerc/talented-easyorder/pull/519#pullrequestreview-5563479986)；source CI [39137275659](https://github.com/cheerc/talented-easyorder/actions/runs/39137275659) build-and-test/e2e均SUCCESS。main CI派工時pending，由coordinator追蹤。

本批只做 Markdown 收據，不寫 plan 設計、不改程式／Rules／測試、不開始 P12 code。前置是 #519 目前 head review 無必修、required CI 綠，由 coordinator squash merge，再核對 main CI；準備文件時若 CI pending，必須如實標示並等綠燈才發布。

## 預期文件

- `docs/DEVELOPMENT-HANDOFF.md`：P11c4a/b 已合併，P11c 完成；P12 已有人類本輪授權，P12a 依 coordinator brief 待派工，不再寫等 CheerC 重新授權。保留歷史暫停記錄的時間語意。
- `docs/PROJECT-STATUS.md` 頂端及對應 phase：區分 P11c 完成、P12 規劃與未實作、未部署／正式驗收未執行。
- `docs/ops/free-production-evidence.md`：#519 source／base／merge、review links、PR/main CI 與驗證來源。舊 head `3fab34e` 的 REWORK R1 與新 head 已補 UI 警示的複審分開；不得將舊 head CI 冒充新 head。
- `docs/superpowers/plans/2026-10-13-free-production-backend-plan.md`：P11c4b receipt 與 P12a 下一步 pointer，與 coordinator master plan 的批次依賴一致。
- 依 coordinator 派工時的明確指示納入本 brief／協調計畫進度與索引；不自行改寫 P12a/b/c 的政策、介面或分批。

## 必須保存的證據界線

- A05 是測試時序修正：受控 causal probe 攔 fast acquire commit、seed expiry、precondition retry 後取得 B/2，再 slow reload；修後 ordering control 先確認前一操作完成及 A/1，才進入過期／慢時鐘階段。保留安全斷言、無新增 timeout/sleep/retry、app／Rules 沒改。不把這個同型機制稱成原 CI 的唯一已證實原因。
- 本機與 CI 一般 Vitest passed/skipped 數字可能不同，依各自原始結果分開標示，不用相同總數代替分類，也不把 skip 當 Emulator pass。
- Q2 是正式 UI shortcut／form 的真 commit，驗有效現金950、原日結實點1000、目標異常消失，及重新關帳後舊補記不計入。保留不同 command IDs 仍可能重複補記的已接受限制與畫面操作提醒，不宣稱 exactly-once。
- 收據自身只做 diff／links／anchors／內容核對，app lint/build/Vitest/Emulator/E2E 未跑就不勾。源實作與 reviewer 的測試來源、revision 和 counts 分開歸屬。

## 交付 gate

核對 pinned main、乾淨 source，保留既有 coordinator 文件變更；中文 commit／push／開 docs-only PR，body 依 template，列 source/merge/review/CI、docs-check、未部署。不得含模型名、本機絕對路徑或真實個資。使用者已授權逐批發布，無需再詢問逐批確認；單批發布後停寫等 coordinator 的下一份 dispatch。

發布後 attach、讀回 provider head／checks，交獨立 reviewer COMMENT review，required CI 綠後僅 coordinator merge。此 receipt 合併前不開始 P12 code，後續由 coordinator 補 pinned base 與具體介面後正式派工 P12a。
