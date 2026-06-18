import React, { useState } from "react";

/**
 * Ref: #329 — BackupScreen is a UI placeholder / prototype.
 *
 * ⚠️ PLACEHOLDER: The progress bar, data counts, and timestamps are all
 * hardcoded. No actual backup/restore logic is connected. This screen
 * serves as a UI mockup for future backup functionality.
 *
 * TODO: Connect to real backup service when implemented.
 */
export const BackupScreen = React.memo(function BackupScreen() {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [op, setOp] = useState<keyof typeof opMeta | null>(null); // 'export-local' | 'import-local' | 'restore-cloud'

  React.useEffect(() => {
    if (step !== 2) return;
    const t = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(t); setStep(3); return 100; }
        return p + 5;
      });
    }, 60);
    return () => clearInterval(t);
  }, [step]);

  const start = (kind: keyof typeof opMeta) => { setOp(kind); setStep(1); };
  const go    = () => { setProgress(0); setStep(2); };
  const reset = () => { setStep(0); setOp(null); setProgress(0); };

  const opMeta = {
    'export-local': { title: '匯出本地備份',  desc: '將目前的 SQLite 資料庫匯出為 .json 檔。', danger: false, btn: '匯出檔案' },
    'import-local': { title: '匯入本地備份',  desc: '從 .json 檔還原資料庫。會覆蓋目前所有資料。', danger: true, btn: '選擇檔案並匯入' },
    'restore-cloud':{ title: '從雲端還原 (DR)', desc: '從 Google Sheets 完整下載並重建本地 SQLite。會覆蓋目前所有資料。', danger: true, btn: '我了解,開始還原' },
  };

  return (
    <div className="screen backup">
      {step === 0 && (
        <div className="bk-cards">
          <div className="card bk-card" onClick={() => start('export-local')}>
            <div className="bk-icon">⬇</div>
            <div className="bk-h">匯出本地備份</div>
            <div className="bk-sub">下載一份 .json 檔做為手動備份。建議每日下班前執行一次。</div>
            <div className="bk-meta mono">最後匯出 · 2026/05/06 18:32</div>
          </div>
          <div className="card bk-card" onClick={() => start('import-local')}>
            <div className="bk-icon">⬆</div>
            <div className="bk-h">匯入本地備份</div>
            <div className="bk-sub">從之前匯出的 .json 檔還原。會覆蓋目前資料。</div>
            <div className="bk-meta dim">小心使用 · 此動作無法復原</div>
          </div>
          <div className="card bk-card bk-card-cloud" onClick={() => start('restore-cloud')}>
            <div className="bk-icon">☁︎</div>
            <div className="bk-h">從雲端還原 (DR)</div>
            <div className="bk-sub">PC 毀損後使用。從 Google Sheets 完整下載並重建本地 SQLite。</div>
            <div className="bk-meta mono">雲端最後更新 · 2026/05/07 11:42</div>
          </div>
        </div>
      )}

      {step >= 1 && op && (
        <div className="card bk-flow">
          <div className="bk-flow-h">{opMeta[op].title}</div>
          <div className="bk-flow-sub">{opMeta[op].desc}</div>

          <div className="rest-meta">
            <div className="rest-meta-row"><span>本地資料筆數</span><span className="mono">12,847</span></div>
            <div className="rest-meta-row"><span>本地最後備份</span><span className="mono">2026/05/06 18:32:14</span></div>
            <div className="rest-meta-row"><span>雲端最後更新</span><span className="mono">2026/05/07 11:42:08</span></div>
          </div>

          {step === 1 && (
            <>
              {opMeta[op].danger && <div className="rest-warn">⚠ 此動作會覆蓋本地資料,無法復原</div>}
              <div className="rest-btns">
                <button className="btn-cancel wide" onClick={reset}>取消</button>
                <button className={'btn-confirm wide ' + (opMeta[op].danger ? 'danger' : '')} onClick={go}>
                  {opMeta[op].btn}
                </button>
              </div>
            </>
          )}
          {step === 2 && (
            <div className="rest-prog">
              <div className="rest-prog-bar"><div className="rest-prog-fill" style={{ width: `${progress}%` }}></div></div>
              <div className="rest-prog-txt mono">{progress}%  ‧  處理中…</div>
            </div>
          )}
          {step === 3 && (
            <div className="rest-done">
              <div className="rest-done-tick">✓</div>
              <div className="rest-done-h">完成</div>
              <div className="rest-done-sub">{op === 'export-local' ? '備份檔已下載 (bento-backup-20260507.json)' : '本地資料庫已重建。'}</div>
              <button className="btn-confirm wide" onClick={reset}>返回</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
