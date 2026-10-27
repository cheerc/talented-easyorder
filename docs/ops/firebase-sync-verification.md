# EasyOrder 雲端驗證入口

- P17 本人實際部署的 HTTPS／Auth／index／CSP／交接／回退逐項表，統一見 [部署指南 S01–S10](DEPLOYMENT-GUIDE.md)。
- 帳務與 P18 三日驗收以 [後端 spec §11](../superpowers/specs/2026-10-13-free-production-backend-spec.md#11-固定驗收案例) 的 A/L/D/R 案例為準。
- 本機 unit、Emulator、E2E 與正式未驗事項分別記在 [ops evidence](free-production-evidence.md)。Emulator 不驗證真正 composite index、Google OAuth、Spark 計費狀態或網路延遲。

舊 Vercel、網域授權、離線排隊入帳與重連自動關帳矩陣已移除；現行 Cloud command online-only，未知結果保留原 command ID，依 receipt／fresh-head 流程處理。
