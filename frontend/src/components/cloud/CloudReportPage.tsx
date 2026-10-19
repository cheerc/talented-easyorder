import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt } from '../../domain/cloudCommands';
import {
  createCloudLedgerDateRange,
  searchCloudReportStudentIds,
  validateCloudLedgerRange,
  type CloudAuditRangeSnapshot,
  type CloudLedgerDateRange,
  type CloudLedgerDateRangeKind,
  type CloudLedgerReport,
  type CloudMergedTransaction,
  type CloudReportTransaction,
} from '../../domain/cloudLedgerReport';
import {
  buildCloudAuditCsv,
  buildCloudMergedTransactionCsv,
  buildCloudPostCloseCsv,
  buildCloudSettlementCsv,
  buildCloudTransactionCsv,
} from '../../domain/cloudLedgerExport';
import { createCloudReadRepository, type CloudReadRepositoryError } from '../../firebase/cloudReadRepository';
import {
  createCloudReportActionRepository,
  type RecordCloudExportInput,
  type RecordCloudPrintInput,
} from '../../firebase/cloudReportActionRepository';
import './CloudReportPage.css';

export interface CloudReportPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  onOpenDayClose?: (dayId: string) => void;
  onOpenAccountHistory?: (studentId: string, range: CloudLedgerDateRange) => void;
}

interface QueryRequest {
  range: CloudLedgerDateRange;
  studentId: string | null;
}

interface Snapshot {
  report: CloudLedgerReport;
  audit: CloudAuditRangeSnapshot;
}

interface FrozenAction {
  id: string;
  kind: 'export' | 'print';
  input: RecordCloudExportInput | RecordCloudPrintInput;
  contents: string;
  filename: string;
  title: string;
  rows: readonly (CloudReportTransaction | CloudMergedTransaction)[];
  phase: 'pending' | 'unknown';
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '無法完整讀取雲端報表';
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error ? String((error as CloudReadRepositoryError).code) : null;
}

function money(value: number): string {
  return `$${new Intl.NumberFormat('zh-TW').format(value)}`;
}

function taipeiTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '時間不正確';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(date);
}

function sameEnvelope(report: CloudLedgerReport, audit: CloudAuditRangeSnapshot, request: QueryRequest, leaseEpoch: number): boolean {
  return report.complete === true && audit.complete === true
    && report.datasetId === audit.datasetId
    && report.sourceSeq === audit.sourceSeq
    && report.leaseEpoch === audit.leaseEpoch && report.leaseEpoch === leaseEpoch
    && report.goLiveDate === audit.goLiveDate
    && report.leaseToday === audit.leaseToday
    && report.range.startDate === request.range.startDate && report.range.endDate === request.range.endDate
    && audit.range.startDate === request.range.startDate && audit.range.endDate === request.range.endDate
    && report.scope.studentId === request.studentId && audit.scope.studentId === request.studentId;
}

function csvFor(type: RecordCloudExportInput['exportType'], snapshot: Snapshot): string {
  switch (type) {
    case 'transactions-original': return buildCloudTransactionCsv(snapshot.report.transactions);
    case 'transactions-merged': return buildCloudMergedTransactionCsv(snapshot.report.mergedTransactions);
    case 'settlements': return buildCloudSettlementCsv(snapshot.report.settlements, snapshot.report.days);
    case 'post-close-entries': return buildCloudPostCloseCsv(snapshot.report.postCloseEntries, snapshot.report.sourceSeq);
    case 'audit': return buildCloudAuditCsv(snapshot.audit.rows, snapshot.audit.sourceSeq);
  }
}

function actionResultMatches(receipt: CommandReceipt | null, action: FrozenAction): receipt is CommandReceipt {
  const expected = action.kind === 'export' ? 'RecordExport' : 'RecordPrint';
  return Boolean(receipt && receipt.commandId === action.id && receipt.kind === expected);
}

function performBrowserAction(action: FrozenAction, performed: Set<string>): void {
  if (performed.has(action.id)) return;
  performed.add(action.id);
  if (action.kind === 'print') {
    window.print();
    return;
  }
  const blob = new Blob([action.contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = action.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function CloudReportPage({
  db, leaseEpoch, identityKey, onNavigationStateChange, onOpenDayClose, onOpenAccountHistory,
}: CloudReportPageProps) {
  const reads = useMemo(() => createCloudReadRepository(db), [db]);
  const actions = useMemo(() => createCloudReportActionRepository(db), [db]);
  const scopeKey = `${identityKey}:${leaseEpoch}`;
  const [leaseToday, setLeaseToday] = useState('');
  const [rangeKind, setRangeKind] = useState<CloudLedgerDateRangeKind>('today');
  const [rangeAnchor, setRangeAnchor] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [query, setQuery] = useState<QueryRequest | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inputError, setInputError] = useState('');
  const [search, setSearch] = useState('');
  const [scopeStudentId, setScopeStudentId] = useState<string | null>(null);
  const [mode, setMode] = useState<'original' | 'merged'>('original');
  const [pageNumber, setPageNumber] = useState(0);
  const [printDate, setPrintDate] = useState('');
  const [action, setAction] = useState<FrozenAction | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [operationBusy, setOperationBusy] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const requestGeneration = useRef(0);
  const operationRef = useRef(false);
  const performedActions = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    onNavigationStateChange?.(identityKey, 'resolved');
    const bootstrapRange: CloudLedgerDateRange = { kind: 'today', startDate: '2000-01-01', endDate: '2000-01-01' };
    void reads.readSummary({ range: bootstrapRange, leaseEpoch }).then(summary => {
      if (!active || requestGeneration.current !== generation) return;
      setSnapshot(null);
      setLoadError('');
      setAction(null);
      setActionMessage('');
      setScopeStudentId(null);
      setSearch('');
      setRangeKind('today');
      setLoading(true);
      setLeaseToday(summary.leaseToday);
      setRangeAnchor(summary.leaseToday);
      const todayRange: CloudLedgerDateRange = {
        kind: 'today', startDate: summary.leaseToday, endDate: summary.leaseToday,
      };
      setCustomStart(todayRange.startDate);
      setCustomEnd(todayRange.endDate);
      setLoading(true);
      setQuery({ range: todayRange, studentId: null });
    }).catch(error => {
      if (!active || requestGeneration.current !== generation) return;
      setLoadError(messageOf(error));
      setLoading(false);
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) {
        setSnapshot(null);
        onNavigationStateChange?.(identityKey, 'revoked');
      }
    });
    return () => { active = false; };
  }, [bootstrapAttempt, identityKey, leaseEpoch, onNavigationStateChange, reads, scopeKey]);

  useEffect(() => {
    if (!query || !leaseToday) return;
    let active = true;
    const generation = ++requestGeneration.current;
    void Promise.all([
      reads.readReport({ range: query.range, studentId: query.studentId, leaseEpoch }),
      reads.readAuditRange({ range: query.range, studentId: query.studentId, leaseEpoch }),
    ]).then(([report, audit]) => {
      if (!active || requestGeneration.current !== generation) return;
      if (!sameEnvelope(report, audit, query, leaseEpoch)) {
        throw new Error('報表與稽核版本不一致，請重新查詢完整資料。');
      }
      setSnapshot({ report, audit });
      setLoading(false);
      setPrintDate(query.range.startDate);
      setActionMessage('');
      onNavigationStateChange?.(identityKey, 'resolved');
    }).catch(error => {
      if (!active || requestGeneration.current !== generation) return;
      setSnapshot(null);
      setLoadError(messageOf(error));
      setLoading(false);
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) {
        onNavigationStateChange?.(identityKey, 'revoked');
      }
    });
    return () => { active = false; };
  }, [identityKey, leaseEpoch, leaseToday, onNavigationStateChange, query, reads, scopeKey]);

  const candidateIds = useMemo(() => snapshot
    ? searchCloudReportStudentIds(snapshot.report.students, snapshot.report.transactions, search)
    : [], [search, snapshot]);
  const candidateById = useMemo(() => new Map(snapshot?.report.students.map(student => [student.studentId, student]) ?? []), [snapshot]);
  const allRows = useMemo(() => {
    if (!snapshot) return [] as (CloudReportTransaction | CloudMergedTransaction)[];
    return mode === 'original' ? snapshot.report.transactions : snapshot.report.mergedTransactions;
  }, [mode, snapshot]);
  const pageCount = Math.max(1, Math.ceil(allRows.length / 100));
  const visibleRows = allRows.slice(pageNumber * 100, (pageNumber + 1) * 100);
  const controlsLocked = loading || Boolean(action);

  const submitRange = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leaseToday || action) return;
    try {
      const next = rangeKind === 'custom'
        ? validateCloudLedgerRange({ kind: 'custom', startDate: customStart, endDate: customEnd })
        : createCloudLedgerDateRange(rangeKind, rangeAnchor || leaseToday);
      setInputError('');
      setScopeStudentId(null);
      setLoading(true);
      setLoadError('');
      setSnapshot(null);
      setPageNumber(0);
      setQuery({ range: next, studentId: null });
    } catch (error) {
      setInputError(messageOf(error));
    }
  }, [action, customEnd, customStart, leaseToday, rangeAnchor, rangeKind]);

  const chooseStudent = useCallback((studentId: string | null) => {
    if (!query || action) return;
    setScopeStudentId(studentId);
    setLoading(true);
    setLoadError('');
    setSnapshot(null);
    setPageNumber(0);
    setQuery({ range: query.range, studentId });
  }, [action, query]);

  const recordAction = useCallback(async (frozen: FrozenAction) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperationBusy(true);
    setAction(frozen);
    setActionMessage('正在確認雲端稽核收據…');
    onNavigationStateChange?.(identityKey, 'recovering');
    try {
      const result = frozen.kind === 'export'
        ? await actions.recordExport(frozen.input as RecordCloudExportInput)
        : await actions.recordPrint(frozen.input as RecordCloudPrintInput);
      if (!result.ok) {
        if (result.error.code !== 'UNKNOWN_RESULT' && result.error.code !== 'OFFLINE') {
          setAction(null);
          setActionMessage(result.error.message);
          if (result.error.code === 'LEASE_LOST' || result.error.code === 'UNAUTHORIZED') {
            setSnapshot(null);
            setSearch('');
            setScopeStudentId(null);
          }
          operationRef.current = false;
          setOperationBusy(false);
          onNavigationStateChange?.(identityKey, result.error.code === 'LEASE_LOST' || result.error.code === 'UNAUTHORIZED' ? 'revoked' : 'resolved');
          return;
        }
        setAction({ ...frozen, phase: 'unknown' });
        setActionMessage('結果尚未確認。保留原命令、範圍與內容；請查詢或用同一命令重試。');
        operationRef.current = false;
        setOperationBusy(false);
        return;
      }
      if (!actionResultMatches(result.receipt, frozen)) throw new Error('稽核收據與固定命令不一致。');
      performBrowserAction(frozen, performedActions.current);
      setAction(null);
      setActionMessage(frozen.kind === 'export' ? '已發起匯出。' : '已發起列印。');
      operationRef.current = false;
      setOperationBusy(false);
      onNavigationStateChange?.(identityKey, 'resolved');
    } catch (error) {
      setAction({ ...frozen, phase: 'unknown' });
      setActionMessage(`結果尚未確認：${messageOf(error)}。請查詢或用同一命令重試。`);
      operationRef.current = false;
      setOperationBusy(false);
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) {
        setSnapshot(null);
        setSearch('');
        setScopeStudentId(null);
        onNavigationStateChange?.(identityKey, 'revoked');
      }
    }
  }, [actions, identityKey, onNavigationStateChange]);

  const makeExport = useCallback((type: RecordCloudExportInput['exportType']) => {
    if (!snapshot || !query || controlsLocked || (type === 'settlements' || type === 'post-close-entries') && query.studentId !== null) return;
    const id = crypto.randomUUID();
    const input: RecordCloudExportInput = {
      commandId: id, leaseEpoch, range: query.range, scope: { studentId: query.studentId },
      sourceSeq: snapshot.report.sourceSeq, exportType: type,
    };
    const names: Record<RecordCloudExportInput['exportType'], string> = {
      'transactions-original': 'transactions-original', 'transactions-merged': 'transactions-merged',
      settlements: 'settlements', 'post-close-entries': 'post-close-entries', audit: 'audit',
    };
    const frozen: FrozenAction = {
      id, kind: 'export', input, contents: csvFor(type, snapshot), filename: `cloud-${names[type]}-${query.range.startDate}_${query.range.endDate}.csv`,
      title: `P${type} · ${query.range.startDate}–${query.range.endDate} · H=${snapshot.report.sourceSeq}`,
      rows: type === 'transactions-merged' ? snapshot.report.mergedTransactions : snapshot.report.transactions,
      phase: 'pending',
    };
    void recordAction(frozen);
  }, [controlsLocked, leaseEpoch, query, recordAction, snapshot]);

  const makePrint = useCallback(() => {
    if (!snapshot || !query || controlsLocked || !/^\d{4}-\d{2}-\d{2}$/.test(printDate)
      || printDate < query.range.startDate || printDate > query.range.endDate) return;
    const id = crypto.randomUUID();
    const printType = mode === 'original' ? 'ledger-original' : 'ledger-merged';
    const input: RecordCloudPrintInput = {
      commandId: id, leaseEpoch, range: query.range, scope: { studentId: query.studentId },
      sourceSeq: snapshot.report.sourceSeq, printType, businessDate: printDate,
    };
    const frozen: FrozenAction = {
      id, kind: 'print', input,
      contents: '', filename: '', title: `雲端帳務 ${query.range.startDate}–${query.range.endDate} · ${query.studentId ?? '全部帳戶'} · H=${snapshot.report.sourceSeq}`,
      rows: mode === 'original' ? snapshot.report.transactions : snapshot.report.mergedTransactions,
      phase: 'pending',
    };
    void recordAction(frozen);
  }, [controlsLocked, leaseEpoch, mode, printDate, query, recordAction, snapshot]);

  const recoverAction = useCallback(async () => {
    if (!action || operationRef.current) return;
    operationRef.current = true;
    setOperationBusy(true);
    setActionMessage('正在伺服器查詢原命令…');
    try {
      const receipt = await actions.readCommand(action.id);
      if (receipt) {
        if (!actionResultMatches(receipt, action)) throw new Error('命令編號的收據種類不符。');
        performBrowserAction(action, performedActions.current);
        setAction(null);
        setActionMessage(action.kind === 'export' ? '已發起匯出。' : '已發起列印。');
        operationRef.current = false;
        setOperationBusy(false);
        onNavigationStateChange?.(identityKey, 'resolved');
        return;
      }
      setActionMessage('伺服器確認尚無收據，使用同一命令編號與固定內容重試…');
      operationRef.current = false;
      setOperationBusy(false);
      await recordAction({ ...action, phase: 'pending' });
    } catch (error) {
      setActionMessage(`仍無法確認原命令：${messageOf(error)}`);
      operationRef.current = false;
      setOperationBusy(false);
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) {
        setSnapshot(null);
        setSearch('');
        setScopeStudentId(null);
        onNavigationStateChange?.(identityKey, 'revoked');
      }
    }
  }, [action, actions, identityKey, onNavigationStateChange, recordAction]);

  const selectedStudent = scopeStudentId ? candidateById.get(scopeStudentId) : undefined;
  const printTitle = action?.kind === 'print' ? action.title : '';

  return (
    <section className="cloud-report" aria-label="雲端報表">
      <header className="cloud-report__header">
        <div><p className="cloud-report__eyebrow">F2 · 完整伺服器快照</p><h2>雲端報表</h2>
          <p>日期範圍由伺服器台北日期 {leaseToday || '讀取中'} 推導；僅在報表與稽核資料版本一致時顯示。</p></div>
        {snapshot && <strong>來源序號 H={snapshot.report.sourceSeq}</strong>}
      </header>

      <form className="cloud-report__controls" onSubmit={submitRange}>
        <label>日期範圍
          <select aria-label="日期範圍" value={rangeKind} disabled={controlsLocked || !leaseToday}
            onChange={event => setRangeKind(event.target.value as CloudLedgerDateRangeKind)}>
            <option value="today">今天</option><option value="week">本週</option><option value="month">本月</option><option value="custom">自訂</option>
          </select>
        </label>
        {rangeKind === 'custom' ? <>
          <label>開始日期<input aria-label="開始日期" type="date" value={customStart} disabled={controlsLocked} onChange={event => setCustomStart(event.target.value)} /></label>
          <label>結束日期<input aria-label="結束日期" type="date" value={customEnd} disabled={controlsLocked} onChange={event => setCustomEnd(event.target.value)} /></label>
          <span>自訂最多 31 日，超出時不會截短。</span>
        </> : <label>範圍日期<input aria-label="範圍日期" type="date" value={rangeAnchor} disabled={controlsLocked} onChange={event => setRangeAnchor(event.target.value)} /></label>}
        <button type="submit" disabled={controlsLocked || !leaseToday}>查詢完整報表</button>
      </form>
      {inputError && <p role="alert">{inputError}</p>}
      {loadError && <div role="alert" className="cloud-report__error"><p>{loadError}</p>
        <button type="button" disabled={Boolean(action)} onClick={() => {
          if (query) { setLoading(true); setSnapshot(null); setLoadError(''); setQuery({ ...query }); }
          else { setLoading(true); setLoadError(''); setBootstrapAttempt(value => value + 1); }
        }}>重新讀取完整資料</button></div>}

      {loading && <p role="status">正在由伺服器讀取完整交易前綴與稽核資料；目前不提供餘額或輸出。</p>}
      {!loading && snapshot && query && <>
        <p className="cloud-report__snapshot" data-testid="report-ready">完整資料已確認：dataset {snapshot.report.datasetId} · {query.range.startDate}–{query.range.endDate} · {query.studentId ? `帳戶 ${query.studentId}` : '全部帳戶'} · 來源序號 H={snapshot.report.sourceSeq}</p>

        <section aria-labelledby="cloud-report-summary-heading" className="cloud-report__section">
          <div className="cloud-report__section-heading"><h3 id="cloud-report-summary-heading">區間日摘要</h3><button type="button" disabled={controlsLocked || !onOpenDayClose}
            onClick={() => onOpenDayClose?.(snapshot.report.days.find(day => day.businessDate === printDate)?.businessDate ?? snapshot.report.range.startDate)}>
            開啟日結 {printDate || snapshot.report.range.startDate}</button></div>
          <p>日摘要與選定帳戶明細分開呈現；現金存量不會跨日加總，未提供訂餐欠款推估。沒有營業日的操作依記錄日期列入稽核。</p>
          <dl className="cloud-report__totals" aria-label="全日摘要合計">
            <div><dt>有效交易</dt><dd>{snapshot.report.summary.activeTransactionCount}</dd></div>
            <div><dt>便當份數</dt><dd>{snapshot.report.summary.bentoCount}</dd></div>
            <div><dt>其他餐點份數</dt><dd>{snapshot.report.summary.otherMealCount}</dd></div>
            <div><dt>餐費</dt><dd>{money(snapshot.report.summary.mealTotal)}</dd></div>
            <div><dt>收款留存與櫃台收入</dt><dd>{money(snapshot.report.summary.totalIncome)}</dd></div>
            <div><dt>櫃台支出</dt><dd>{money(snapshot.report.summary.totalExpense)}</dd></div>
            <div><dt>帳戶退款</dt><dd>{money(snapshot.report.summary.totalRefund)}</dd></div>
            <div><dt>區間淨現金流</dt><dd>{money(snapshot.report.summary.netCash)}</dd></div>
          </dl>
          <div className="cloud-report__table-wrap"><table><thead><tr><th>營業日</th><th>狀態</th><th>份數</th><th>餐費</th><th>收款留存</th><th>櫃台收入／支出</th><th>帳戶退款</th><th>日結現金</th><th>日結操作</th></tr></thead>
            <tbody>{snapshot.report.days.map(day => <tr key={day.businessDate}>
              <td>{day.businessDate}</td><td>{day.status ?? '未建立'}</td><td>{day.totals ? `${day.totals.bentoCount} + ${day.totals.otherMealCount}` : '—'}</td>
              <td>{day.totals ? money(day.totals.mealTotal) : '—'}</td><td>{day.totals ? money(day.totals.retainedReceipts) : '—'}</td>
              <td>{day.totals ? `${money(day.totals.cashierIncome)} / ${money(day.totals.cashierExpense)}` : '—'}</td>
              <td>{day.totals ? money(day.totals.accountRefunds) : '—'}</td>
              <td>{day.lastSettlementRevision > 0 ? <>{day.settlements.map(version => <div key={version.revision}>
                第 {version.revision} 次實點 {version.countedCash === null ? '—' : money(version.countedCash)}{day.status === 'closed' && version.revision === day.lastSettlementRevision ? ` · 有效現金 ${money(day.effectiveCash ?? version.countedCash ?? 0)}` : ''}
                <small>{version.actorUid} · {taipeiTime(version.committedAt)} · {version.note || '無備註'}</small>
              </div>)}{day.postCloseEntries.map(entry => <small key={entry.entryId}>
                補記 {entry.direction === 'income' ? '收入' : '支出'} {money(entry.amount)} · {entry.reason} · {entry.createdBy} · {taipeiTime(entry.createdAt)} · 原日結第 {entry.settlementRevision} 次 · {entry.countedInEffectiveCash ? '計入有效現金' : '未計入有效現金'}
              </small>)}</> : '未關帳'}</td>
              <td><button type="button" aria-label={`開啟日結 ${day.businessDate}`} disabled={controlsLocked || !onOpenDayClose} onClick={() => onOpenDayClose?.(day.businessDate)}>開啟日結</button></td>
            </tr>)}</tbody></table></div>
        </section>

        <section className="cloud-report__section" aria-labelledby="cloud-report-scope-heading">
          <div className="cloud-report__section-heading"><h3 id="cloud-report-scope-heading">帳戶明細範圍</h3>
            {selectedStudent && <button type="button" disabled={controlsLocked} onClick={() => chooseStudent(null)}>清除帳戶範圍</button>}</div>
          <label>搜尋帳戶<input aria-label="搜尋帳戶" value={search} disabled={controlsLocked} onChange={event => setSearch(event.target.value)} placeholder="編號、現名、別名或範圍內交易快照名" /></label>
          {!scopeStudentId && search.trim() && <div aria-label="候選帳戶">
            {candidateIds.length > 1 && <p>找到多個候選；選取一位後才會改變輸出範圍，目前仍是全部帳戶。</p>}
            {candidateIds.length === 0 ? <p>沒有符合的帳戶。未選取時輸出範圍仍是全部帳戶。</p> : candidateIds.map(studentId => {
              const student = candidateById.get(studentId);
              if (!student) return null;
              return <button type="button" key={studentId} aria-label={`選取 ${student.displayName}（${student.studentCode}）`} disabled={controlsLocked}
                onClick={() => chooseStudent(studentId)}>{student.displayName}（{student.studentCode}）</button>;
            })}
          </div>}
          <p>目前明細範圍：{selectedStudent ? `${selectedStudent.displayName}（${selectedStudent.studentCode}）` : '全部帳戶'}。日摘要與日結數字維持全日口徑。</p>
          {selectedStudent && <button type="button" disabled={controlsLocked || !onOpenAccountHistory}
            aria-label={`開啟查帳：${selectedStudent.displayName}`} onClick={() => onOpenAccountHistory?.(selectedStudent.studentId, query.range)}>
            開啟查帳：{selectedStudent.displayName}</button>}
        </section>

        <section className="cloud-report__section" aria-labelledby="cloud-report-detail-heading">
          <div className="cloud-report__section-heading"><h3 id="cloud-report-detail-heading">完整交易明細</h3>
            <div><label>呈現方式<select aria-label="交易呈現方式" value={mode} disabled={controlsLocked} onChange={event => { setMode(event.target.value as typeof mode); setPageNumber(0); }}>
              <option value="original">原始交易</option><option value="merged">合併交易</option></select></label>
              <span>輸出使用全部 {allRows.length} 筆完整模型，畫面每頁 100 筆。</span></div>
          </div>
          <div className="cloud-report__table-wrap"><table><thead><tr><th>營業日</th><th>帳戶與當時姓名</th><th>類型／狀態</th><th>餐點快照</th><th>金額／份數</th><th>完整歷史餘額</th><th>操作者／台北時間</th><th>回填／說明</th></tr></thead>
            <tbody>{visibleRows.map(row => {
              const merged = 'kind' in row;
              const raw = merged ? row.transactions : [row];
              const balance = row.afterBalance;
              const mealText = merged ? row.otherMealItems.join('、') || row.menuNameSnapshot : row.menuNameSnapshot || row.otherItemName || '—';
              return <tr key={`${merged ? 'merged' : 'raw'}:${row.transactionId}`}>
                <td>{row.businessDate}</td><td>{row.studentNameSnapshot}（{row.studentId}）</td>
                <td>{merged ? row.kind : row.type} · {row.status === 'active' ? '有效' : '已作廢'}</td><td>{mealText}</td>
                <td>{money(row.amount)} · 餐費 {money(row.mealPrice)} · 收款 {money(row.paidAmount)}{merged && row.orderCount ? ` · ${row.orderCount} 筆訂餐／${row.bentoOrderCount} 份便當` : ''}</td>
                <td>{row.studentId === '__cashier__' ? '不適用' : balance === undefined ? '未驗證' : money(balance)}</td>
                <td>{raw.map(item => <div key={item.transactionId}>{item.operatorUid} · {taipeiTime(item.createdAt)}</div>)}</td>
                <td>{row.backfilled ? '回填' : '—'}{raw.some(item => item.status === 'voided') ? ' · 保留作廢列' : ''}{raw.map(item => item.note && <small key={`note:${item.transactionId}`}>{item.note}</small>)}</td>
              </tr>;
            })}</tbody></table></div>
          <div className="cloud-report__pager"><button type="button" disabled={controlsLocked || pageNumber === 0} onClick={() => setPageNumber(value => value - 1)}>上一頁</button>
            <span>第 {pageNumber + 1} / {pageCount} 頁 · 全部 {allRows.length} 筆</span>
            <button type="button" disabled={controlsLocked || pageNumber + 1 >= pageCount} onClick={() => setPageNumber(value => value + 1)}>下一頁</button></div>
        </section>

        <section className="cloud-report__section" aria-labelledby="cloud-report-exports-heading">
          <h3 id="cloud-report-exports-heading">收據確認後輸出</h3>
          <p>輸出固定目前日期、帳戶範圍與來源序號 H={snapshot.report.sourceSeq}；日結與關帳後補記僅支援全部帳戶範圍。</p>
          <div className="cloud-report__actions">
            <button type="button" disabled={controlsLocked} onClick={() => makeExport('transactions-original')}>匯出原始交易 CSV</button>
            <button type="button" disabled={controlsLocked} onClick={() => makeExport('transactions-merged')}>匯出合併交易 CSV</button>
            <button type="button" disabled={controlsLocked || query.studentId !== null} onClick={() => makeExport('settlements')}>匯出日結 CSV</button>
            <button type="button" disabled={controlsLocked || query.studentId !== null} onClick={() => makeExport('post-close-entries')}>匯出關帳後補記 CSV</button>
            <button type="button" aria-label="匯出稽核 CSV" disabled={controlsLocked} onClick={() => makeExport('audit')}>匯出稽核 CSV</button>
          </div>
          <label>列印標示日期<select aria-label="列印標示日期" value={printDate} disabled={controlsLocked} onChange={event => setPrintDate(event.target.value)}>
            {snapshot.report.days.map(day => <option key={day.businessDate} value={day.businessDate}>{day.businessDate}</option>)}
          </select></label>
          <button type="button" disabled={controlsLocked || !snapshot.report.days.length} onClick={makePrint}>記錄後列印目前完整明細</button>
        </section>
      </>}

      {action && <div className="cloud-report__recovery" role="region" aria-label="輸出命令確認">
        <p>{action.phase === 'unknown' ? '輸出結果待確認' : '輸出命令處理中'}：{action.title} · ID {action.id}</p>
        <button type="button" disabled={operationBusy} onClick={() => void recoverAction()}>查詢原命令並以同 ID 復原</button>
      </div>}
      {actionMessage && <p role="status">{actionMessage}</p>}

      {action?.kind === 'print' && <article className="cloud-report__print" aria-label="本次固定列印內容">
        <h1>{printTitle}</h1>
        <p>營業日標示：{(action.input as RecordCloudPrintInput).businessDate} · 完整資料列數：{action.rows.length}</p>
        <table><thead><tr><th>營業日</th><th>帳戶</th><th>姓名快照</th><th>類型</th><th>金額</th><th>餘額</th><th>來源序號</th></tr></thead>
          <tbody>{action.rows.map(row => <tr key={row.transactionId}><td>{row.businessDate}</td><td>{row.studentId}</td><td>{row.studentNameSnapshot}</td>
            <td>{'kind' in row ? row.kind : row.type}</td><td>{money(row.amount)}</td><td>{row.afterBalance === undefined ? '—' : money(row.afterBalance)}</td><td>{row.sourceSeq}</td></tr>)}</tbody>
        </table>
      </article>}
    </section>
  );
}
