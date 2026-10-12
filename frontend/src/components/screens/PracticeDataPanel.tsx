import React, { useRef, useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useMenu, useStudents, useTransactions, usePracticeDataActions, useSession, useSimulationDate } from '../../store/selectors';
import { shiftBusinessDate } from '../../domain/businessDate';
import { getTaiwanDate } from '../../utils/dateTime';
import { usePosStore } from '../../store/posStore';
import { isMenuReady } from '../../domain/menu';
import { isPrototypeMode } from '../../appMode';
import {
  buildSnapshot, countDataset, parseSnapshot, pickDataset, snapshotFileName,
  type DatasetCounts, type PracticeSnapshot,
} from '../../domain/practiceSnapshot';

// M0：F3「練習資料」。只在本機模式（未連 Firebase）顯示。
// 見 docs/superpowers/specs/frontend-prototype-workflow-spec.md §3 S-DATA。

type PendingAction =
  | { kind: 'blank' }
  | { kind: 'sample' }
  | { kind: 'clearTx' }
  | { kind: 'restore'; snapshot: PracticeSnapshot; counts: DatasetCounts; fileName: string };

function describeCounts(c: DatasetCounts): string {
  return `${c.students} 位帳戶、${c.vendors} 家供應商、${c.transactions} 筆交易、${c.auditEvents} 筆更正紀錄、${c.dailySettlements} 筆關帳、${c.cashSessions} 天開帳`;
}

function downloadJson(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立即 revoke 會讓部分瀏覽器失去檔名或中斷下載，延後釋放。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const PracticeDataPanel = React.memo(function PracticeDataPanel({ hasCashSession }: { hasCashSession: boolean }) {
  const { students } = useStudents();
  const { transactions } = useTransactions();
  const { todayMenu, vendors } = useMenu();
  const { auditEvents, dailySettlements, cashSessions } = useSession();
  const { startBlankData, loadSampleData, restoreDataset, clearPracticeTransactions, setSimulationDate } = usePracticeDataActions();
  const simulationDate = useSimulationDate();
  const practiceDate = simulationDate ?? getTaiwanDate();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current: DatasetCounts = {
    students: students.length,
    vendors: vendors.length,
    transactions: transactions.length,
    auditEvents: auditEvents.length,
    dailySettlements: dailySettlements.length,
    cashSessions: Object.keys(cashSessions).length,
  };

  const steps = [
    { done: students.length > 0, label: '建立帳戶（右側「學員管理」）' },
    { done: vendors.length > 0, label: '新增供應商（F4 供應商）' },
    { done: isMenuReady(todayMenu), label: '設定今日晚餐（上方「今日便當設定」）' },
    { done: hasCashSession, label: '設定開帳金額（上方「每日開帳金額」）' },
  ];

  const exportSnapshot = () => {
    const now = new Date();
    const snapshot = buildSnapshot(pickDataset(usePosStore.getState()), now.toISOString());
    const fileName = snapshotFileName(now);
    downloadJson(fileName, JSON.stringify(snapshot, null, 2));
    setNotice({ kind: 'ok', text: `已匯出 ${fileName}（${describeCounts(countDataset(snapshot.data))}）。` });
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const result = parseSnapshot(await file.text());
    if (!result.ok) {
      setNotice({ kind: 'error', text: `無法還原「${file.name}」：${result.reason} 目前資料沒有變更。` });
      return;
    }
    setNotice(null);
    setPending({ kind: 'restore', snapshot: result.snapshot, counts: result.counts, fileName: file.name });
  };

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === 'blank') startBlankData();
    if (pending.kind === 'sample') loadSampleData();
    if (pending.kind === 'clearTx') clearPracticeTransactions();
    if (pending.kind === 'restore') restoreDataset(pending.snapshot.data);
    const done = {
      blank: '已改成空白資料。',
      sample: '已載入驗收範例。',
      clearTx: '已清除練習交易，名單與供應商保留，餘額回到期初。',
      restore: '已還原快照。',
    }[pending.kind];
    setNotice({ kind: 'ok', text: done });
    setPending(null);
  };

  const dialog = (() => {
    if (!pending) return { title: '', message: '', confirmLabel: '' };
    const exportHint = '如需保留目前資料，請先取消並按「匯出快照」。按取消不會變更任何資料。';
    switch (pending.kind) {
      case 'blank':
        return { title: '從空白開始', message: `將清除目前的 ${describeCounts(current)}，改成完全空白的資料。${exportHint}`, confirmLabel: '確認清空' };
      case 'sample':
        return { title: '載入驗收範例', message: `將清除目前的 ${describeCounts(current)}，改成固定的匿名驗收範例。${exportHint}`, confirmLabel: '確認載入範例' };
      case 'clearTx':
        return {
          title: '只清除練習交易',
          message: `將清除 ${current.transactions} 筆交易、${current.auditEvents} 筆更正紀錄、${current.dailySettlements} 筆關帳、${current.cashSessions} 天開帳；`
            + `保留 ${current.students} 位帳戶（餘額回到期初）、${current.vendors} 家供應商與今日菜單。${exportHint}`,
          confirmLabel: '確認清除交易',
        };
      case 'restore':
        return {
          title: '還原快照',
          message: `「${pending.fileName}」匯出於 ${new Date(pending.snapshot.exportedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}，含 ${describeCounts(pending.counts)}。`
            + `將整份取代目前的 ${describeCounts(current)}。${exportHint}`,
          confirmLabel: '確認還原',
        };
    }
  })();

  return (
    <div style={{ marginTop: '40px', borderTop: '1px solid var(--line)', paddingTop: '20px' }} aria-label="練習資料">
      <div className="card-h">練習資料 <span className="card-h-sub">{isPrototypeMode ? '本機練習 · 僅此瀏覽器' : '本機模式 · 未連雲端'}</span></div>
      <p className="dim" style={{ fontSize: '13px', marginBottom: '10px' }}>
        目前：{students.length} 位帳戶、{vendors.length} 家供應商、{transactions.length} 筆交易
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button className="ghost-btn" onClick={exportSnapshot}>匯出快照</button>
        <button className="ghost-btn" onClick={() => fileInputRef.current?.click()}>還原快照…</button>
        <button className="ghost-btn" onClick={() => setPending({ kind: 'clearTx' })}>只清除練習交易…</button>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
        <button className="ghost-btn" onClick={() => setPending({ kind: 'blank' })}>從空白開始…</button>
        <button className="ghost-btn" onClick={() => setPending({ kind: 'sample' })}>載入驗收範例…</button>
      </div>
      <input ref={fileInputRef} type="file" accept="application/json,.json" aria-label="選擇快照檔" onChange={onFileChosen} style={{ display: 'none' }} />
      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} style={{ fontSize: '13px', margin: '8px 0 0', color: notice.kind === 'error' ? 'var(--red)' : 'var(--accent-ink)' }}>
          {notice.text}
        </p>
      )}
      {isPrototypeMode && (
        <div aria-label="練習營業日" style={{ marginTop: '16px' }}>
          <div className="card-h" style={{ fontSize: '13px' }}>
            練習營業日 <span className="card-h-sub">{simulationDate ? '模擬中' : '使用今天的實際日期'}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              className="adm-input mono"
              aria-label="設定練習營業日"
              value={practiceDate}
              onChange={e => { if (e.target.value) setSimulationDate(e.target.value); }}
              style={{ width: 'auto' }}
            />
            <button className="ghost-btn" onClick={() => setSimulationDate(shiftBusinessDate(practiceDate, 1))}>下一個練習日</button>
            {simulationDate && <button className="ghost-btn" onClick={() => setSimulationDate(null)}>回到實際日期</button>}
          </div>
          <p className="dim" style={{ fontSize: '12px', margin: '4px 0 0' }}>
            新交易記在練習營業日；前幾天的交易與關帳都保留，可用上方日期查看。切換日期時 F1 未送出的輸入會清除。
          </p>
        </div>
      )}
      <div className="card-h" style={{ marginTop: '16px', fontSize: '13px' }}>開始訂餐前的準備</div>
      <ol style={{ fontSize: '13px', margin: '4px 0 0', paddingLeft: '20px' }} aria-label="開始訂餐前的準備">
        {steps.map(step => (
          <li key={step.label} style={{ color: step.done ? 'var(--ink-3)' : 'inherit' }}>
            {step.done ? '✓ ' : ''}{step.label}
          </li>
        ))}
      </ol>
      <ConfirmDialog
        open={pending !== null}
        title={dialog.title}
        message={dialog.message}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
        confirmLabel={dialog.confirmLabel}
        variant="danger"
      />
    </div>
  );
});
