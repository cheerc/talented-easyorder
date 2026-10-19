import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt } from '../../domain/cloudCommands';
import type { CloudLedgerDateRange, CloudReportTransaction } from '../../domain/cloudLedgerReport';
import type { CorrectTransactionPayload } from '../../domain/cloudTransactionMutation';
import { createCloudLedgerDateRange, validateCloudLedgerRange } from '../../domain/cloudLedgerReport';
import { createCloudReadRepository, type CloudReadRepositoryError } from '../../firebase/cloudReadRepository';
import { createCloudStudentRepository, listCloudStudents, type CloudStudentRecord } from '../../firebase/cloudStudentRepository';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../../firebase/cloudOrderRepository';
import './CloudAccountHistoryPage.css';

export interface CloudAccountHistoryPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  initialStudentId?: string | null;
  initialRange?: CloudLedgerDateRange | null;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
}

interface HistorySnapshot {
  account: Awaited<ReturnType<ReturnType<typeof createCloudReadRepository>['readAccountHistory']>>;
  report: Awaited<ReturnType<ReturnType<typeof createCloudReadRepository>['readReport']>>;
  students: Awaited<ReturnType<typeof listCloudStudents>>;
  audit: Awaited<ReturnType<ReturnType<typeof createCloudReadRepository>['readAuditRange']>>;
}

interface FrozenMutation {
  input: CloudTransactionMutationInput;
  phase: 'pending' | 'unknown';
  transaction: CloudReportTransaction;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error ? String((error as CloudReadRepositoryError).code) : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '無法完整讀取帳戶歷史';
}

function integerText(value: string, { allowZero = true }: { allowZero?: boolean } = {}): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && (allowZero ? number >= 0 : number >= 1) && number <= 1_000_000_000 ? number : null;
}

function formatMoney(value: number): string {
  return `$${new Intl.NumberFormat('zh-TW').format(value)}`;
}

function formatTaipeiTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '時間不正確';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(date);
}

function matchingEnvelope(snapshot: HistorySnapshot, studentId: string, range: CloudLedgerDateRange, leaseEpoch: number): boolean {
  return snapshot.account.complete === true && snapshot.report.complete === true && snapshot.audit.complete === true
    && snapshot.account.datasetId === snapshot.report.datasetId && snapshot.account.datasetId === snapshot.audit.datasetId
    && snapshot.account.sourceSeq === snapshot.report.sourceSeq && snapshot.account.sourceSeq === snapshot.audit.sourceSeq
    && snapshot.account.sourceSeq === snapshot.students.seq
    && snapshot.account.leaseEpoch === snapshot.report.leaseEpoch && snapshot.account.leaseEpoch === snapshot.audit.leaseEpoch
    && snapshot.account.leaseEpoch === leaseEpoch
    && snapshot.account.leaseToday === snapshot.report.leaseToday && snapshot.account.leaseToday === snapshot.audit.leaseToday
    && snapshot.account.range.startDate === range.startDate && snapshot.account.range.endDate === range.endDate
    && snapshot.report.range.startDate === range.startDate && snapshot.report.range.endDate === range.endDate
    && snapshot.audit.range.startDate === range.startDate && snapshot.audit.range.endDate === range.endDate
    && snapshot.account.scope.studentId === studentId && snapshot.report.scope.studentId === studentId
    && snapshot.audit.scope.studentId === studentId
    && snapshot.students.datasetId === snapshot.account.datasetId
    && snapshot.students.goLiveDate === snapshot.account.goLiveDate;
}

function receiptMatches(receipt: CommandReceipt | null, frozen: FrozenMutation): receipt is CommandReceipt {
  return Boolean(receipt && receipt.commandId === frozen.input.commandId && receipt.kind === frozen.input.kind);
}

export function CloudAccountHistoryPage({
  db, leaseEpoch, identityKey, initialStudentId = null, initialRange = null, onNavigationStateChange,
}: CloudAccountHistoryPageProps) {
  const reads = useMemo(() => createCloudReadRepository(db), [db]);
  const studentsRepository = useMemo(() => createCloudStudentRepository(db), [db]);
  const orders = useMemo(() => createCloudOrderRepository(db), [db]);
  const scopeKey = `${identityKey}:${leaseEpoch}`;
  const [leaseToday, setLeaseToday] = useState('');
  const [students, setStudents] = useState<CloudStudentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialStudentId);
  const [search, setSearch] = useState('');
  const [rangeKind, setRangeKind] = useState<CloudLedgerDateRange['kind']>(initialRange?.kind ?? 'today');
  const [anchorDate, setAnchorDate] = useState(initialRange?.startDate ?? '');
  const [startDate, setStartDate] = useState(initialRange?.startDate ?? '');
  const [endDate, setEndDate] = useState(initialRange?.endDate ?? '');
  const [range, setRange] = useState<CloudLedgerDateRange | null>(null);
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState<{ transaction: CloudReportTransaction; kind: 'correct' | 'void' } | null>(null);
  const [mealPriceText, setMealPriceText] = useState('');
  const [paidAmountText, setPaidAmountText] = useState('');
  const [refundAmountText, setRefundAmountText] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [frozen, setFrozen] = useState<FrozenMutation | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const generationRef = useRef(0);
  const operationRef = useRef(false);
  const submitFrozenRef = useRef<(candidate: FrozenMutation) => Promise<void>>(async () => undefined);

  useEffect(() => {
    let active = true;
    const generation = ++generationRef.current;
    onNavigationStateChange?.(identityKey, 'resolved');
    const probe: CloudLedgerDateRange = { kind: 'today', startDate: '2000-01-01', endDate: '2000-01-01' };
    void Promise.all([
      reads.readSummary({ range: probe, leaseEpoch }),
      studentsRepository.list(),
    ]).then(([summary, list]) => {
      if (!active || generationRef.current !== generation) return;
      setSnapshot(null);
      setLoading(true);
      setLoadError('');
      setNotice('');
      setFrozen(null);
      setDraft(null);
      setLeaseToday(summary.leaseToday);
      setStudents(list.students);
      const nextRange = initialRange
        ? validateCloudLedgerRange(initialRange)
        : createCloudLedgerDateRange('today', summary.leaseToday);
      setRangeKind(nextRange.kind);
      setAnchorDate(nextRange.startDate);
      setStartDate(nextRange.startDate);
      setEndDate(nextRange.endDate);
      setRange(nextRange);
      const nextStudentId = initialStudentId && list.students.some(student => student.studentId === initialStudentId)
        ? initialStudentId : null;
      setSelectedId(nextStudentId);
      setLoading(nextStudentId !== null);
      onNavigationStateChange?.(identityKey, 'resolved');
    }).catch(error => {
      if (!active || generationRef.current !== generation) return;
      setLoadError(errorText(error));
      setLoading(false);
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) onNavigationStateChange?.(identityKey, 'revoked');
    });
    return () => { active = false; };
  }, [bootstrapAttempt, identityKey, initialRange, initialStudentId, leaseEpoch, onNavigationStateChange, reads, scopeKey, studentsRepository]);

  useEffect(() => {
    if (!range || !selectedId || !leaseToday) return;
    let active = true;
    const generation = ++generationRef.current;
    const queryInput = { range, studentId: selectedId, leaseEpoch };
    void Promise.all([
      reads.readAccountHistory(queryInput),
      reads.readReport(queryInput),
      reads.readAuditRange(queryInput),
      studentsRepository.list(),
    ]).then(([account, report, audit, currentStudents]) => {
      if (!active || generationRef.current !== generation) return;
      const complete = { account, report, audit, students: currentStudents };
      if (!matchingEnvelope(complete, selectedId, range, leaseEpoch)) {
        throw new Error('查帳、日結、稽核與學生版本不一致；未顯示部分資料。');
      }
      setStudents(currentStudents.students);
      setSnapshot(complete);
      setLoading(false);
      setNotice('');
      onNavigationStateChange?.(identityKey, 'resolved');
    }).catch(error => {
      if (!active || generationRef.current !== generation) return;
      setSnapshot(null);
      setLoadError(errorText(error));
      setLoading(false);
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) onNavigationStateChange?.(identityKey, 'revoked');
    });
    return () => { active = false; };
  }, [identityKey, leaseEpoch, leaseToday, onNavigationStateChange, range, reads, refresh, scopeKey, selectedId, studentsRepository]);

  const candidateStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return [];
    return students.filter(student => [student.studentCode, student.displayName, ...student.aliases]
      .some(value => value.toLocaleLowerCase().includes(needle)));
  }, [search, students]);
  const currentStudent = snapshot?.students.students.find(student => student.studentId === selectedId) ?? null;
  const rangeDayByDate = useMemo(() => new Map(snapshot?.report.days.map(day => [day.businessDate, day]) ?? []), [snapshot]);

  const loadAgain = useCallback(() => {
    if (frozen) return;
    if (!range || !selectedId || !leaseToday) {
      setLoading(true);
      setLoadError('');
      setBootstrapAttempt(value => value + 1);
      return;
    }
    setLoading(true);
    setSnapshot(null);
    setLoadError('');
    setRefresh(value => value + 1);
  }, [frozen, leaseToday, range, selectedId]);

  const submitRange = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (frozen || !leaseToday) return;
    try {
      const next = rangeKind === 'custom' ? validateCloudLedgerRange({ kind: 'custom', startDate, endDate })
        : createCloudLedgerDateRange(rangeKind, anchorDate || leaseToday);
      setFormError('');
      setLoading(true);
      setSnapshot(null);
      setLoadError('');
      setRange(next);
    } catch (error) { setFormError(errorText(error)); }
  }, [anchorDate, endDate, frozen, leaseToday, rangeKind, startDate]);

  const canMutate = useCallback((transaction: CloudReportTransaction) => {
    const day = rangeDayByDate.get(transaction.businessDate);
    return transaction.businessDate < (snapshot?.account.leaseToday ?? '')
      && transaction.status === 'active' && day?.status === 'open'
      && day.lastSettlementRevision === 0 && day.revision !== null;
  }, [rangeDayByDate, snapshot?.account.leaseToday]);

  const openDraft = useCallback((transaction: CloudReportTransaction, kind: 'correct' | 'void') => {
    if (frozen || !canMutate(transaction)) return;
    setDraft({ transaction, kind });
    setMealPriceText(String(transaction.mealPrice));
    setPaidAmountText(String(transaction.paidAmount));
    setRefundAmountText(String(transaction.amount));
    setNote(transaction.note);
    setReason('');
    setFormError('');
  }, [canMutate, frozen]);

  const recoverCommand = useCallback(async () => {
    if (!frozen || operationRef.current) return;
    operationRef.current = true;
    setOperationBusy(true);
    setNotice('正在伺服器查詢原更正命令…');
    try {
      const receipt = await orders.readCommand(frozen.input.commandId);
      if (receipt) {
        if (!receiptMatches(receipt, frozen)) throw new Error('原命令收據種類或編號不符。');
        setFrozen(null);
        operationRef.current = false;
        setOperationBusy(false);
        setNotice('原命令已確認；重新讀取完整帳戶歷史。');
        onNavigationStateChange?.(identityKey, 'resolved');
        setDraft(null);
        setLoading(true);
        setSnapshot(null);
        setRefresh(value => value + 1);
        return;
      }
      operationRef.current = false;
      setOperationBusy(false);
      await submitFrozenRef.current(frozen);
    } catch (error) {
      operationRef.current = false;
      setOperationBusy(false);
      setNotice(`仍無法確認原命令：${errorText(error)}`);
    }
  }, [frozen, identityKey, onNavigationStateChange, orders]);

  const submitFrozen = useCallback(async (candidate: FrozenMutation) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperationBusy(true);
    setFrozen({ ...candidate, phase: 'pending' });
    setNotice('正在送出固定版本的歷史更正…');
    onNavigationStateChange?.(identityKey, 'recovering');
    try {
      const result = await orders.mutateTransaction(candidate.input);
      if (!result.ok) {
        if (result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
          setFrozen({ ...candidate, phase: 'unknown' });
          setNotice('更正結果待確認；保留原命令編號、payload 與 revisions。');
          operationRef.current = false;
          setOperationBusy(false);
          return;
        }
        setFrozen(null);
        operationRef.current = false;
        setOperationBusy(false);
        if (result.error.code === 'REVISION_CONFLICT') {
          setDraft(null);
          setNotice('資料版本已變更。已重新載入完整歷史；請檢視新資料後重新開啟更正並確認，不會自動重送舊內容。');
          setLoading(true);
          setSnapshot(null);
          setLoadError('');
          setRefresh(value => value + 1);
          onNavigationStateChange?.(identityKey, 'resolved');
        } else {
          setNotice(result.error.message);
          if (result.error.code === 'DAY_CLOSED') {
            setLoading(true);
            setSnapshot(null);
            setLoadError('');
            setDraft(null);
            setRefresh(value => value + 1);
          }
          if (result.error.code === 'LEASE_LOST' || result.error.code === 'UNAUTHORIZED') {
            setSnapshot(null);
            setStudents([]);
            setDraft(null);
            setLoading(false);
          }
          onNavigationStateChange?.(identityKey, result.error.code === 'LEASE_LOST' || result.error.code === 'UNAUTHORIZED' ? 'revoked' : 'resolved');
        }
        return;
      }
      if (result.receipt.commandId !== candidate.input.commandId || result.receipt.kind !== candidate.input.kind) {
        throw new Error('伺服器收據與固定更正命令不一致。');
      }
      setFrozen(null);
      setDraft(null);
      setNotice('更正收據已確認；正在依新來源序號重讀完整歷史。');
      operationRef.current = false;
      setOperationBusy(false);
      onNavigationStateChange?.(identityKey, 'resolved');
      setLoading(true);
      setSnapshot(null);
      setLoadError('');
      setRefresh(value => value + 1);
    } catch (error) {
      setFrozen({ ...candidate, phase: 'unknown' });
      operationRef.current = false;
      setOperationBusy(false);
      setNotice(`更正結果待確認：${errorText(error)}。請查詢原命令。`);
      if (errorCode(error) === 'LEASE_LOST' || errorCode(error) === 'UNAUTHORIZED') {
        setSnapshot(null);
        setStudents([]);
        setDraft(null);
        setLoading(false);
        onNavigationStateChange?.(identityKey, 'revoked');
      }
    }
  }, [identityKey, onNavigationStateChange, orders]);

  useEffect(() => { submitFrozenRef.current = submitFrozen; }, [submitFrozen]);

  const submitMutation = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !snapshot || !currentStudent || !range || frozen) return;
    const day = rangeDayByDate.get(draft.transaction.businessDate);
    if (!day || day.status !== 'open' || day.lastSettlementRevision !== 0 || day.revision === null
      || draft.transaction.status !== 'active') {
      setFormError('這筆交易所屬營業日已關帳或缺少完整版本，歷史查帳唯讀。');
      return;
    }
    const reasonValue = reason.trim();
    if (!reasonValue) { setFormError('請填寫更正理由。'); return; }
    const common = {
      commandId: crypto.randomUUID(), leaseEpoch, transactionId: draft.transaction.transactionId,
      studentId: selectedId!, dayId: draft.transaction.businessDate,
      expectedTransactionRevision: draft.transaction.revision,
      expectedStudentRevision: currentStudent.revision,
      expectedDayRevision: day.revision,
    };
    if (draft.kind === 'void') {
      const input: CloudTransactionMutationInput = {
        ...common, kind: 'VoidTransaction', payload: { reason: reasonValue },
      };
      setFormError('');
      void submitFrozen({ input, phase: 'pending', transaction: draft.transaction });
      return;
    }

    let payload: CorrectTransactionPayload;
    if (draft.transaction.type === 'refund') {
      const amount = integerText(refundAmountText, { allowZero: false });
      if (amount === null || amount > draft.transaction.amount || !note.trim()) {
        setFormError('退款更正金額必須是正整數且不可增加；說明不可空白。');
        return;
      }
      const correction: CorrectTransactionPayload = { mealPrice: 0, paidAmount: 0, amount, note: note.trim(), reason: reasonValue };
      payload = correction;
    } else if (draft.transaction.type === 'payment') {
      const paidAmount = integerText(paidAmountText, { allowZero: false });
      if (paidAmount === null) { setFormError('收款金額必須是 1 到 1,000,000,000 的整數。'); return; }
      payload = { mealPrice: 0, paidAmount, amount: paidAmount, note: note.trim(), reason: reasonValue };
    } else {
      const mealPrice = integerText(mealPriceText);
      const paidAmount = integerText(paidAmountText);
      if (mealPrice === null || paidAmount === null || mealPrice > 1_000_000 || paidAmount > 1_000_000) {
        setFormError('餐費與收款必須是 0 到 1,000,000 的整數。');
        return;
      }
      payload = { mealPrice, paidAmount, amount: paidAmount - mealPrice, note: note.trim(), reason: reasonValue };
    }
    const input: CloudTransactionMutationInput = {
      ...common, kind: 'CorrectTransaction', payload,
    };
    setFormError('');
    void submitFrozen({ input, phase: 'pending', transaction: draft.transaction });
  }, [currentStudent, draft, frozen, leaseEpoch, note, range, rangeDayByDate, reason, selectedId, snapshot,
    mealPriceText, paidAmountText, refundAmountText, submitFrozen]);

  const retryButtonDisabled = loading || Boolean(frozen);

  return (
    <section className="cloud-account-history" aria-label="雲端查帳">
      <header className="cloud-account-history__header"><div><p className="cloud-account-history__eyebrow">F5 · 帳戶完整歷史前綴</p>
        <h2>雲端查帳與歷史更正</h2><p>使用目前學生名單映射帳戶 ID；餘額依目前更正後資料重算，不代表當時現金快照。</p></div>
        {snapshot && <strong>來源序號 H={snapshot.account.sourceSeq}</strong>}
      </header>

      <div className="cloud-account-history__controls">
        <label>搜尋目前帳戶<input aria-label="搜尋目前學生帳戶" value={search} disabled={retryButtonDisabled}
          onChange={event => setSearch(event.target.value)} placeholder="目前編號、姓名或別名" /></label>
        {search.trim() && <div aria-label="目前帳戶候選">{candidateStudents.map(student => <button type="button" key={student.studentId}
          disabled={retryButtonDisabled} onClick={() => {
            setSelectedId(student.studentId); setSnapshot(null); setLoading(true); setLoadError('');
          }}>
          {student.displayName}（{student.studentCode}）
        </button>)}</div>}
        <form onSubmit={submitRange}>
          <label>日期範圍<select aria-label="查帳日期範圍" value={rangeKind} disabled={retryButtonDisabled}
            onChange={event => setRangeKind(event.target.value as CloudLedgerDateRange['kind'])}>
            <option value="today">今天</option><option value="week">本週</option><option value="month">本月</option><option value="custom">自訂</option>
          </select></label>
          {rangeKind === 'custom' ? <><label>開始日期<input aria-label="查帳開始日期" type="date" value={startDate} disabled={retryButtonDisabled} onChange={event => setStartDate(event.target.value)} /></label>
            <label>結束日期<input aria-label="查帳結束日期" type="date" value={endDate} disabled={retryButtonDisabled} onChange={event => setEndDate(event.target.value)} /></label></>
            : <label>範圍日期<input aria-label="查帳範圍日期" type="date" value={anchorDate} disabled={retryButtonDisabled} onChange={event => setAnchorDate(event.target.value)} /></label>}
          <button type="submit" disabled={retryButtonDisabled}>查詢完整歷史</button>
        </form>
      </div>
      {formError && <p role="alert">{formError}</p>}
      {loadError && <div role="alert"><p>{loadError}</p><button type="button" disabled={Boolean(frozen)} onClick={loadAgain}>重新讀取</button></div>}
      {loading && <p role="status">正在伺服器完整讀取帳戶歷史前綴、日結與稽核資料；尚未完整前不顯示逐筆餘額或更正入口。</p>}
      {!loading && !selectedId && !loadError && <p>請搜尋並選取目前學生名單中的帳戶。</p>}
      {!loading && snapshot && currentStudent && range && <>
        <p className="cloud-account-history__snapshot" data-testid="account-history-ready">dataset {snapshot.account.datasetId} · {range.startDate}–{range.endDate} · {currentStudent.displayName}（目前編號 {currentStudent.studentCode}） · 來源序號 H={snapshot.account.sourceSeq}</p>
        <dl className="cloud-account-history__balance">
          <div><dt>期初餘額</dt><dd>{formatMoney(snapshot.account.openingBalance)}</dd></div>
          <div><dt>目前帳戶餘額</dt><dd>{formatMoney(snapshot.account.currentBalance)}</dd></div>
          <div><dt>帳戶狀態</dt><dd>{currentStudent.status}</dd></div>
          <div><dt>學生版本</dt><dd>{currentStudent.revision}</dd></div>
        </dl>
        <p><strong>依目前更正後資料重算</strong> · 各筆餘額來自完整前綴驗證；本日結版本另列，不視為交易當時餘額。</p>

        <section aria-labelledby="account-transactions-heading"><h3 id="account-transactions-heading">區間交易與更正入口</h3>
          <div className="cloud-account-history__table-wrap"><table><thead><tr><th>營業日／時間</th><th>交易</th><th>當時姓名</th><th>金額</th><th>重算後餘額</th><th>狀態／回填</th><th>日狀態</th><th>操作</th></tr></thead><tbody>
            {snapshot.account.transactions.map(transaction => {
              const day = rangeDayByDate.get(transaction.businessDate);
              const eligible = canMutate(transaction);
              return <tr key={transaction.transactionId}>
                <td>{transaction.businessDate}<small>{formatTaipeiTime(transaction.createdAt)}</small></td>
                <td>{transaction.type} · {transaction.transactionId}<details><summary>交易與稽核詳情</summary>
                  <dl><dt>建立命令</dt><dd>{transaction.lastCommandId}</dd><dt>建立者</dt><dd>{transaction.operatorUid} · {transaction.operatorEmail}</dd>
                    <dt>當時菜單</dt><dd>{transaction.menuNameSnapshot} · {transaction.vendorNameSnapshot}</dd><dt>回填</dt><dd>{transaction.backfilled ? '是' : '否'}</dd>
                    <dt>交易備註</dt><dd>{transaction.note || '—'}</dd></dl>
                  {snapshot.audit.rows.filter(row => row.studentId === selectedId && (row.commandId === transaction.lastCommandId
                    || JSON.stringify(row.before).includes(transaction.transactionId) || JSON.stringify(row.after).includes(transaction.transactionId)))
                    .map(row => <article key={row.commandId}><strong>{row.kind} · {row.commandId} · seq {row.seq} · {row.dateBasis === 'committed-at' ? '按記錄日期歸屬' : '按營業日歸屬'}</strong>
                      <p>{row.reason || '無理由'} · {row.actorUid} · {row.actorEmail} · {formatTaipeiTime(row.committedAt)}</p>
                      <pre>before: {JSON.stringify(row.before, null, 2)}{'\n'}after: {JSON.stringify(row.after, null, 2)}</pre></article>)}
                </details></td>
                <td>{transaction.studentNameSnapshot}</td><td>{formatMoney(transaction.amount)} · 餐費 {formatMoney(transaction.mealPrice)} · 收款 {formatMoney(transaction.paidAmount)}</td>
                <td>{transaction.afterBalance === undefined || transaction.balanceApplicability !== 'verified' ? '未驗證' : formatMoney(transaction.afterBalance)}</td>
                <td>{transaction.status === 'voided' ? '已作廢（保留原列）' : '有效'}{transaction.backfilled ? ' · 回填' : ''}</td>
                <td>{day?.status ?? '無日文件'}{day?.lastSettlementRevision ? ` · 曾關帳第 ${day.lastSettlementRevision} 版` : ''}</td>
                <td>{eligible ? <><button type="button" disabled={Boolean(frozen)} onClick={() => openDraft(transaction, 'correct')}>更正</button>
                  <button type="button" disabled={Boolean(frozen)} onClick={() => openDraft(transaction, 'void')}>作廢</button></>
                  : <span>{day?.status === 'closed' || day?.lastSettlementRevision ? '唯讀；現金差額請到日結補記' : '唯讀'}</span>}</td>
              </tr>;
            })}
          </tbody></table></div>
          {snapshot.account.transactions.length === 0 && <p>此範圍沒有帳戶交易；完整前綴餘額仍已驗證。</p>}
        </section>

        <section aria-labelledby="account-settlements-heading"><h3 id="account-settlements-heading">日結版本（全日現金，不代表此帳戶餘額）</h3>
          {snapshot.report.settlements.map(settlement => <article key={`${settlement.businessDate}:${settlement.revision}`}>
            <strong>{settlement.businessDate} · 第 {settlement.revision} 版 · {settlement.status}</strong>
            <p>應有現金 {formatMoney(settlement.expectedCash)} · 實點 {settlement.countedCash === null ? '—' : formatMoney(settlement.countedCash)} · {settlement.actorUid} · {formatTaipeiTime(settlement.committedAt)}</p>
            <p>{settlement.note || '無備註'}</p>
          </article>)}
          {snapshot.report.settlements.length === 0 && <p>此範圍沒有日結版本。</p>}
          {snapshot.report.postCloseEntries.map(entry => <article key={entry.entryId}>
            <strong>{entry.businessDate} · 日結第 {entry.settlementRevision} 版後補記 · {entry.direction === 'income' ? '收入' : '支出'} {formatMoney(entry.amount)}</strong>
            <p>{entry.reason} · {entry.createdBy} · {formatTaipeiTime(entry.createdAt)} · {entry.countedInEffectiveCash ? '計入有效現金' : '未計入有效現金'}</p>
          </article>)}
        </section>

        <section aria-labelledby="account-audit-heading"><h3 id="account-audit-heading">帳戶範圍稽核</h3>
          <p>沒有營業日的操作依台北記錄日期列入；本次稽核只涵蓋此帳戶與選定區間。</p>
          <div className="cloud-account-history__table-wrap"><table><thead><tr><th>seq／命令</th><th>有效日期與依據</th><th>操作人／時間</th><th>理由</th><th>before / after</th></tr></thead><tbody>
            {snapshot.audit.rows.map(row => <tr key={row.commandId}><td>{row.seq} · {row.kind}<small>{row.commandId}</small></td>
              <td>{row.attributedDate} · {row.dateBasis === 'business-date' ? '營業日' : '記錄日（台北）'}<small>原營業日：{row.businessDate ?? '無'}</small></td>
              <td>{row.actorUid} · {row.actorEmail}<small>{formatTaipeiTime(row.committedAt)}</small></td><td>{row.reason ?? '—'}</td>
              <td><details><summary>查看</summary><pre>before: {JSON.stringify(row.before, null, 2)}{'\n'}after: {JSON.stringify(row.after, null, 2)}</pre></details></td></tr>)}
          </tbody></table></div>
        </section>
      </>}

      {draft && <form className="cloud-account-history__mutation" aria-label="歷史交易更正" onSubmit={submitMutation}>
        <h3>{draft.kind === 'void' ? '作廢歷史交易' : '更正歷史交易'} · {draft.transaction.transactionId}</h3>
        <p>固定交易版本 {draft.transaction.revision}、學生版本 {currentStudent?.revision ?? '—'}、日期版本 {rangeDayByDate.get(draft.transaction.businessDate)?.revision ?? '—'}。此頁只允許仍未曾關帳的營業日。</p>
        {draft.kind === 'correct' && draft.transaction.type === 'order' && <>
          <label>餐費<input aria-label="更正餐費" inputMode="numeric" disabled={Boolean(frozen) || operationBusy} value={mealPriceText} onChange={event => setMealPriceText(event.target.value)} /></label>
          <label>收款<input aria-label="更正收款" inputMode="numeric" disabled={Boolean(frozen) || operationBusy} value={paidAmountText} onChange={event => setPaidAmountText(event.target.value)} /></label>
        </>}
        {draft.kind === 'correct' && draft.transaction.type === 'payment' && <label>收款金額<input aria-label="更正收款金額" inputMode="numeric" disabled={Boolean(frozen) || operationBusy} value={paidAmountText} onChange={event => setPaidAmountText(event.target.value)} /></label>}
        {draft.kind === 'correct' && draft.transaction.type === 'refund' && <label>退款金額<input aria-label="更正退款金額" inputMode="numeric" disabled={Boolean(frozen) || operationBusy} value={refundAmountText} onChange={event => setRefundAmountText(event.target.value)} /></label>}
        {draft.kind === 'correct' && <label>交易備註<input aria-label="交易備註" disabled={Boolean(frozen) || operationBusy} value={note} onChange={event => setNote(event.target.value)} /></label>}
        <label>更正理由<input aria-label="更正理由" disabled={Boolean(frozen) || operationBusy} value={reason} onChange={event => setReason(event.target.value)} required /></label>
        <button type="submit" disabled={Boolean(frozen) || operationBusy}>確認送出</button>
        <button type="button" disabled={Boolean(frozen) || operationBusy} onClick={() => { setDraft(null); setFormError(''); }}>取消</button>
      </form>}
      {frozen && <section className="cloud-account-history__recovery" aria-label="歷史更正命令恢復">
        <p>{frozen.phase === 'unknown' ? '更正結果待確認' : '更正命令處理中'}：ID {frozen.input.commandId} · 交易 {frozen.transaction.transactionId}</p>
        <button type="button" disabled={operationBusy} onClick={() => void recoverCommand()}>查詢原命令並以同 ID 復原</button>
      </section>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
