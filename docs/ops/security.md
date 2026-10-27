# EasyOrder 安全操作入口

正式後端的安全契約以[spec §4–§9](../superpowers/specs/2026-10-13-free-production-backend-spec.md)為準：Google verified identity、精確白名單、單一活躍 UID、online-only command、Rules 原子驗證、加密備份與失權清理。登入畫面不是後端授權的替代品。

- 正式 Firebase／OAuth／DNS、公開 Web config 的本機配置及部署步驟見 [P17 部署指南](DEPLOYMENT-GUIDE.md)；管理憑證／名單不交給 agent、不進 repo。
- Cloud 診斷採 spec §8 的 strict allowlist；不以 prototype 的自由文字 sanitize logger 推定 Cloud 無個資。錯誤訊息不回顯 provider 原始內容；部署支援只回報匿名 case ID／固定錯誤碼。
- [備份](firebase-backup-runbook.md)與[復原](firebase-restore-runbook.md)分別有本機驗證、第二副本及隔離目標要求；檔案已下載不等於備份／復原已驗。
- 本機／Emulator 工程結果與正式 smoke 狀態見 [ops evidence](free-production-evidence.md)，尚未做的正式 gate 保持 UNVERIFIED。
