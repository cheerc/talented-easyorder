import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { normalizeStudentCode } from '../../domain/student';
import {
  createCloudDayVendorRepository,
  type CloudDayRecord,
  type CloudDayVendorRepository,
} from '../../firebase/cloudDayVendorRepository';
import {
  createCloudOrderRepository,
  type CloudOrderRepository,
} from '../../firebase/cloudOrderRepository';
import {
  createCloudStudentRepository,
  type CloudStudentRecord,
  type CloudStudentRepository,
} from '../../firebase/cloudStudentRepository';
import { type CloudTransactionDoc, timestampToISOString } from '../../firebase/firestoreSchema';
import { formatTaipeiTime, getTaiwanDate } from '../../utils/dateTime';
import './CloudOrdersPage.css';

export interface CloudOrdersPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
}

interface RecentAccountItem {
  studentId: string;
  studentCode: string;
  displayName: string;
  summary: string;
}

interface OrdersPageState {
  identityKey: string;
  authorizationRevoked: boolean;
  loading: boolean;
  loadError: string;
  actionError: string;
  notice: string;
  students: CloudStudentRecord[];
  day: CloudDayRecord | null;
  transactions: CloudTransactionDoc[];
  search: string;
  selectedStudentId: string | null;
  mealKind: 'bento' | 'other';
  otherItemName: string;
  otherPriceText: string;
  paidAmountText: string;
  note: string;
  confirmDuplicateOpen: boolean;
  paymentDetailsOpen: boolean;
  submitting: boolean;
}

const initialOrdersPageState = (identityKey: string): OrdersPageState => ({
  identityKey,
  authorizationRevoked: false,
  loading: true,
  loadError: '',
  actionError: '',
  notice: '',
  students: [],
  day: null,
  transactions: [],
  search: '',
  selectedStudentId: null,
  mealKind: 'bento',
  otherItemName: '',
  otherPriceText: '',
  paidAmountText: '',
  note: '',
  confirmDuplicateOpen: false,
  paymentDetailsOpen: false,
  submitting: false,
});

export function CloudOrdersPage({
  db,
  leaseEpoch,
  identityKey,
  onNavigationStateChange,
}: CloudOrdersPageProps) {
  const [pageState, setPageStateRaw] = useState<OrdersPageState>(() => initialOrdersPageState(identityKey));
  const [prevIdentityKey, setPrevIdentityKey] = useState(identityKey);

  if (prevIdentityKey !== identityKey) {
    setPrevIdentityKey(identityKey);
    setPageStateRaw(initialOrdersPageState(identityKey));
  }

  const page = pageState.identityKey === identityKey ? pageState : initialOrdersPageState(identityKey);

  const setPage = useCallback((updater: (prev: OrdersPageState) => OrdersPageState) => {
    setPageStateRaw(prev => {
      const current = prev.identityKey === identityKey ? prev : initialOrdersPageState(identityKey);
      return updater(current);
    });
  }, [identityKey]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const today = useMemo(() => getTaiwanDate(), []);

  const studentRepo = useMemo<CloudStudentRepository>(() => createCloudStudentRepository(db), [db]);
  const dayVendorRepo = useMemo<CloudDayVendorRepository>(() => createCloudDayVendorRepository(db), [db]);
  const orderRepo = useMemo<CloudOrderRepository>(() => createCloudOrderRepository(db), [db]);

  const loadData = useCallback(async () => {
    const currentKey = identityKey;
    if (!currentKey) {
      onNavigationStateChange?.(currentKey, 'revoked');
      return;
    }
    setPage(prev => ({ ...prev, loading: true, loadError: '' }));
    try {
      const [studentsResult, dayResult, txsResult] = await Promise.all([
        studentRepo.list(),
        dayVendorRepo.getDay(today),
        orderRepo.listDayTransactions(today),
      ]);
      setPage(prev => ({
        ...prev,
        loading: false,
        loadError: '',
        students: studentsResult.students,
        day: dayResult,
        transactions: txsResult,
      }));
      onNavigationStateChange?.(currentKey, 'resolved');
    } catch (err) {
      const message = err instanceof Error ? err.message : '載入雲端資料失敗';
      setPage(prev => ({ ...prev, loading: false, loadError: message }));
      onNavigationStateChange?.(currentKey, 'recovering');
    }
  }, [dayVendorRepo, identityKey, onNavigationStateChange, orderRepo, setPage, studentRepo, today]);

  useEffect(() => {
    const currentKey = identityKey;
    let active = true;

    if (!currentKey) {
      onNavigationStateChange?.(currentKey, 'revoked');
      return;
    }

    void (async () => {
      try {
        const [studentsResult, dayResult, txsResult] = await Promise.all([
          studentRepo.list(),
          dayVendorRepo.getDay(today),
          orderRepo.listDayTransactions(today),
        ]);
        if (!active) return;
        setPage(prev => ({
          ...prev,
          loading: false,
          loadError: '',
          students: studentsResult.students,
          day: dayResult,
          transactions: txsResult,
        }));
        onNavigationStateChange?.(currentKey, 'resolved');
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : '載入雲端資料失敗';
        setPage(prev => ({ ...prev, loading: false, loadError: message }));
        onNavigationStateChange?.(currentKey, 'recovering');
      }
    })();

    return () => {
      active = false;
    };
  }, [dayVendorRepo, identityKey, onNavigationStateChange, orderRepo, setPage, studentRepo, today]);

  const selectedStudent = useMemo(() => {
    return page.students.find(s => s.studentId === page.selectedStudentId) ?? null;
  }, [page.selectedStudentId, page.students]);

  // 當日餐點計數（依 U2a 定稿）
  const bentoCount = useMemo(() => {
    return page.transactions.filter(t => t.mealKind === 'bento' && t.status === 'active').length;
  }, [page.transactions]);

  const otherMealCount = useMemo(() => {
    return page.transactions.filter(t => t.mealKind === 'other' && t.status === 'active').length;
  }, [page.transactions]);

  const todayMenu = page.day?.menu ?? null;

  // 搜尋過濾
  const filteredStudents = useMemo(() => {
    const q = page.search.trim();
    if (!q) return [];
    let normCode = '';
    const norm = normalizeStudentCode(q);
    if (norm.ok) {
      normCode = norm.code;
    }
    return page.students.filter(s => {
      if (normCode && s.studentCode === normCode) return true;
      if (s.studentCode.includes(q)) return true;
      if (s.displayName.toLowerCase().includes(q.toLowerCase())) return true;
      if (s.aliases.some(a => a.toLowerCase().includes(q.toLowerCase()))) return true;
      return false;
    });
  }, [page.search, page.students]);

  // 選中學生當日交易
  const selectedStudentTodayOrders = useMemo(() => {
    if (!page.selectedStudentId) return [];
    return page.transactions.filter(t => t.studentId === page.selectedStudentId && t.status === 'active');
  }, [page.selectedStudentId, page.transactions]);

  // 最近帳戶列表（依 U2a 定稿）
  const recentAccounts = useMemo<RecentAccountItem[]>(() => {
    const seen = new Set<string>();
    const list: RecentAccountItem[] = [];
    for (const tx of page.transactions) {
      if (seen.has(tx.studentId)) continue;
      seen.add(tx.studentId);
      const student = page.students.find(s => s.studentId === tx.studentId);
      if (!student) continue;

      const studentTxs = page.transactions.filter(t => t.studentId === tx.studentId && t.status === 'active');
      const bCount = studentTxs.filter(t => t.mealKind === 'bento').length;
      const oCount = studentTxs.filter(t => t.mealKind === 'other').length;

      let summary: string;
      if (bCount > 0 && oCount > 0) {
        summary = `今日餐點 ${bCount}・其他餐點 ${oCount}`;
      } else if (bCount > 0) {
        summary = `今日餐點 ${bCount}`;
      } else if (oCount > 0) {
        summary = `其他餐點 ${oCount}`;
      } else {
        summary = '僅繳費';
      }

      list.push({
        studentId: student.studentId,
        studentCode: student.studentCode,
        displayName: student.displayName,
        summary,
      });
    }
    return list;
  }, [page.students, page.transactions]);

  // 選擇學生
  const handleSelectStudent = (student: CloudStudentRecord) => {
    setPage(prev => ({
      ...prev,
      selectedStudentId: student.studentId,
      search: '',
      actionError: '',
    }));
  };

  // 取消選擇或回到搜尋
  const handleCancelSelection = useCallback(() => {
    setPage(prev => ({
      ...prev,
      selectedStudentId: null,
      mealKind: 'bento',
      otherItemName: '',
      otherPriceText: '',
      paidAmountText: '',
      note: '',
      actionError: '',
    }));
    searchInputRef.current?.focus();
  }, [setPage]);

  // 金額試算
  const mealPrice = useMemo(() => {
    if (page.mealKind === 'bento') {
      return todayMenu ? todayMenu.price : 0;
    }
    const parsed = parseInt(page.otherPriceText.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }, [page.mealKind, page.otherPriceText, todayMenu]);

  const paidAmount = useMemo(() => {
    const parsed = parseInt(page.paidAmountText.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }, [page.paidAmountText]);

  const previewBalance = useMemo(() => {
    if (!selectedStudent) return 0;
    return selectedStudent.currentBalance + paidAmount - mealPrice;
  }, [mealPrice, paidAmount, selectedStudent]);

  // 送單主邏輯
  const executeSubmitOrder = async () => {
    if (!selectedStudent) return;
    if (selectedStudent.status === 'inactive') {
      setPage(prev => ({ ...prev, actionError: '此帳戶已停用，禁止新增餐點' }));
      return;
    }
    if (!page.day) {
      setPage(prev => ({ ...prev, actionError: '當日營業日尚未初始化' }));
      return;
    }
    if (page.mealKind === 'bento' && !todayMenu) {
      setPage(prev => ({ ...prev, actionError: '今日尚未設定菜單，無法訂購今日餐點' }));
      return;
    }
    if (page.mealKind === 'other') {
      const trimmedName = page.otherItemName.trim();
      if (!trimmedName || trimmedName.length > 100) {
        setPage(prev => ({ ...prev, actionError: '其他餐點品名必填且不能超過 100 字元' }));
        return;
      }
      const price = parseInt(page.otherPriceText.trim(), 10);
      if (!Number.isSafeInteger(price) || price < 0 || price > 1_000_000) {
        setPage(prev => ({ ...prev, actionError: '餐點單價必須在 0 到 1,000,000 之間' }));
        return;
      }
    }
    const paid = page.paidAmountText.trim() === '' ? 0 : parseInt(page.paidAmountText.trim(), 10);
    if (!Number.isSafeInteger(paid) || paid < 0 || paid > 1_000_000) {
      setPage(prev => ({ ...prev, actionError: '實收金額必須在 0 到 1,000,000 之間' }));
      return;
    }

    setPage(prev => ({ ...prev, submitting: true, actionError: '', notice: '' }));
    try {
      const commandId = crypto.randomUUID();
      const result = await orderRepo.createOrder({
        commandId,
        leaseEpoch,
        studentId: selectedStudent.studentId,
        dayId: today,
        expectedStudentRevision: selectedStudent.revision,
        expectedDayRevision: page.day.revision,
        mealKind: page.mealKind,
        mealPrice,
        paidAmount: paid,
        menuRevision: page.mealKind === 'bento' ? (todayMenu?.revision ?? null) : null,
        otherItemName: page.mealKind === 'other' ? page.otherItemName.trim() : null,
        note: page.note.trim(),
      });

      if (!result.ok) {
        if (result.error.code === 'REVISION_CONFLICT') {
          setPage(prev => ({
            ...prev,
            submitting: false,
            confirmDuplicateOpen: false,
            actionError: '伺服器菜單或資料已變更，請重新確認最新資訊',
          }));
        } else {
          setPage(prev => ({
            ...prev,
            submitting: false,
            confirmDuplicateOpen: false,
            actionError: result.error.message || '訂餐失敗',
          }));
        }
        return;
      }

      setPage(prev => ({
        ...prev,
        submitting: false,
        confirmDuplicateOpen: false,
        notice: `已確認 ${selectedStudent.studentCode} ${selectedStudent.displayName} 訂餐完成`,
        selectedStudentId: null,
        mealKind: 'bento',
        otherItemName: '',
        otherPriceText: '',
        paidAmountText: '',
        note: '',
      }));
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '提交訂餐發生未知錯誤';
      setPage(prev => ({
        ...prev,
        submitting: false,
        confirmDuplicateOpen: false,
        actionError: msg,
      }));
    }
  };

  // 點擊確認登記按鈕
  const handleRequestSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedStudent || page.submitting) return;

    if (selectedStudent.status === 'inactive') {
      setPage(prev => ({ ...prev, actionError: '此帳戶已停用，禁止新增餐點' }));
      return;
    }

    // 檢查重複加訂
    if (selectedStudentTodayOrders.length > 0) {
      setPage(prev => ({ ...prev, confirmDuplicateOpen: true }));
      return;
    }

    void executeSubmitOrder();
  };

  // 全域快捷鍵監聽（Q, E, Esc）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (page.confirmDuplicateOpen || page.paymentDetailsOpen || page.submitting) {
        if (e.key === 'Escape') {
          setPage(prev => ({ ...prev, confirmDuplicateOpen: false, paymentDetailsOpen: false }));
        }
        return;
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea';

      if (!isInput) {
        if (e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          setPage(prev => ({ ...prev, mealKind: 'bento' }));
        } else if (e.key === 'e' || e.key === 'E') {
          if (page.selectedStudentId) {
            e.preventDefault();
            setPage(prev => ({ ...prev, paymentDetailsOpen: true }));
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleCancelSelection();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCancelSelection, page.confirmDuplicateOpen, page.paymentDetailsOpen, page.selectedStudentId, page.submitting, setPage]);

  return (
    <div className="cloud-orders" data-testid="cloud-orders-page">
      {/* 頂部 Header 與右上角兩行餐點計數（U2a 定稿） */}
      <header className="cloud-orders__header">
        <div className="cloud-orders__header-info">
          <h2>雲端櫃台點餐</h2>
          <span className="cloud-orders__date-label">營業日：{today}</span>
        </div>
        <div className="cloud-orders__topbar-counts" data-testid="cloud-topbar-counts">
          <div className="cloud-orders__topbar-row" data-testid="cloud-topbar-bento">
            <span
              className="cloud-orders__topbar-label"
              title={todayMenu ? todayMenu.itemName : '未設定'}
            >
              今日餐點（{todayMenu ? todayMenu.itemName : '未設定'}）
            </span>
            <span className="cloud-orders__topbar-number">{bentoCount}</span>
          </div>
          <div className="cloud-orders__topbar-row" data-testid="cloud-topbar-other">
            <span className="cloud-orders__topbar-label">其他餐點</span>
            <span className="cloud-orders__topbar-number">{otherMealCount}</span>
          </div>
        </div>
      </header>

      {page.loading && (
        <div className="cloud-orders__notice" data-testid="cloud-orders-loading" role="status">
          載入雲端資料中...
        </div>
      )}

      {page.notice && (
        <div className="cloud-orders__notice" role="status" aria-live="polite">
          {page.notice}
        </div>
      )}

      {page.actionError && (
        <div className="cloud-orders__error" role="alert">
          {page.actionError}
        </div>
      )}

      {page.loadError && (
        <div className="cloud-orders__error" role="alert">
          {page.loadError}
          <button type="button" onClick={() => void loadData()}>
            重試載入
          </button>
        </div>
      )}

      <div className="cloud-orders__content">
        {/* 左側主面板 */}
        <div className="cloud-orders__main-panel">
          {/* 搜尋學生 */}
          <div className="cloud-orders__card">
            {!selectedStudent ? (
              <div className="cloud-orders__search-group">
                <label htmlFor="cloud-student-search">搜尋學員</label>
                <input
                  id="cloud-student-search"
                  ref={searchInputRef}
                  className="cloud-orders__search-input"
                  type="text"
                  placeholder="輸入編號、姓名或別名..."
                  value={page.search}
                  onChange={e => {
                    const val = e.target.value;
                    setPage(prev => ({ ...prev, search: val }));
                  }}
                  aria-label="搜尋編號、姓名或別名"
                  autoComplete="off"
                  disabled={page.loading || page.submitting}
                />
                {filteredStudents.length > 0 && (
                  <ul className="cloud-orders__search-dropdown" role="listbox">
                    {filteredStudents.slice(0, 10).map(s => (
                      <li
                        key={s.studentId}
                        className={`cloud-orders__search-item ${
                          s.status === 'inactive' ? 'cloud-orders__search-item--inactive' : ''
                        }`}
                        onClick={() => handleSelectStudent(s)}
                        data-testid={`search-result-${s.studentCode}`}
                        role="option"
                        aria-selected="false"
                      >
                        <span>
                          <strong>{s.studentCode}</strong> {s.displayName}
                          {s.status === 'inactive' && (
                            <span className="cloud-orders__student-badge">已停用</span>
                          )}
                        </span>
                        <span>結餘 ${s.currentBalance}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="cloud-orders__selected-student" data-testid="selected-student-card">
                <div className="cloud-orders__selected-info">
                  <span>
                    編號：<strong>{selectedStudent.studentCode}</strong>
                  </span>
                  <span>
                    姓名：<strong>{selectedStudent.displayName}</strong>
                  </span>
                  <span>目前餘額：${selectedStudent.currentBalance}</span>
                  {selectedStudent.status === 'inactive' && (
                    <span className="cloud-orders__student-badge">已停用</span>
                  )}
                </div>
                <button
                  type="button"
                  className="cloud-orders__btn-secondary"
                  onClick={handleCancelSelection}
                  disabled={page.submitting}
                >
                  更換學員
                </button>
              </div>
            )}
          </div>

          {/* 訂餐表單 */}
          {selectedStudent && (
            <div className="cloud-orders__card">
              {selectedStudent.status === 'inactive' ? (
                <div className="cloud-orders__error" role="alert">
                  此帳戶已停用，禁止新增餐點
                </div>
              ) : (
                <form onSubmit={handleRequestSubmit}>
                  {/* 模式切換 */}
                  <div className="cloud-orders__mode-selector">
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={page.mealKind === 'bento'}
                      onClick={() => setPage(prev => ({ ...prev, mealKind: 'bento' }))}
                      disabled={page.submitting}
                    >
                      今日餐點（Q）
                    </button>
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={page.mealKind === 'other'}
                      onClick={() => setPage(prev => ({ ...prev, mealKind: 'other' }))}
                      disabled={page.submitting}
                    >
                      其他餐點
                    </button>
                  </div>

                  {page.mealKind === 'bento' ? (
                    <div className="cloud-orders__bento-info">
                      {todayMenu ? (
                        <p>
                          品名：<strong>{todayMenu.itemName}</strong>｜單價：
                          <strong>${todayMenu.price}</strong>
                        </p>
                      ) : (
                        <p className="cloud-orders__error">
                          今日尚未設定菜單，無法訂購今日餐點
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="cloud-orders__form-grid">
                      <div className="cloud-orders__field">
                        <label htmlFor="other-item-name">餐點品名（必填）</label>
                        <input
                          id="other-item-name"
                          type="text"
                          placeholder="例如：炒麵、水餃"
                          value={page.otherItemName}
                          onChange={e => {
                            const val = e.target.value;
                            setPage(prev => ({ ...prev, otherItemName: val }));
                          }}
                          maxLength={100}
                          disabled={page.submitting}
                        />
                      </div>
                      <div className="cloud-orders__field">
                        <label htmlFor="other-item-price">餐點單價（必填）</label>
                        <input
                          id="other-item-price"
                          type="number"
                          placeholder="0"
                          min="0"
                          max="1000000"
                          value={page.otherPriceText}
                          onChange={e => {
                            const val = e.target.value;
                            setPage(prev => ({ ...prev, otherPriceText: val }));
                          }}
                          disabled={page.submitting}
                        />
                      </div>
                    </div>
                  )}

                  <div className="cloud-orders__form-grid">
                    <div className="cloud-orders__field">
                      <label htmlFor="paid-amount">實收金額（留空為 0 元）</label>
                      <input
                        id="paid-amount"
                        type="number"
                        placeholder="0"
                        min="0"
                        max="1000000"
                        value={page.paidAmountText}
                        onChange={e => {
                          const val = e.target.value;
                          setPage(prev => ({ ...prev, paidAmountText: val }));
                        }}
                        disabled={page.submitting}
                      />
                    </div>
                    <div className="cloud-orders__field">
                      <label htmlFor="order-note">備註（選填）</label>
                      <input
                        id="order-note"
                        type="text"
                        placeholder="選填備註..."
                        value={page.note}
                        onChange={e => {
                          const val = e.target.value;
                          setPage(prev => ({ ...prev, note: val }));
                        }}
                        maxLength={500}
                        disabled={page.submitting}
                      />
                    </div>
                  </div>

                  <div className="cloud-orders__preview-bar">
                    <span>本次餐費：${mealPrice}</span>
                    <span>實收金額：${paidAmount}</span>
                    <span>
                      預估結餘：${previewBalance}
                      {previewBalance < 0 && (
                        <strong style={{ color: '#dc2626' }}>
                          （欠款 ${Math.abs(previewBalance)}）
                        </strong>
                      )}
                    </span>
                  </div>

                  <div className="cloud-orders__actions">
                    <button
                      type="submit"
                      className="cloud-orders__btn-primary"
                      disabled={
                        page.submitting ||
                        (page.mealKind === 'bento' && !todayMenu) ||
                        (page.mealKind === 'other' && (!page.otherItemName.trim() || !page.otherPriceText.trim()))
                      }
                      data-testid="submit-order-button"
                    >
                      {page.submitting ? '處理中...' : '確認登記（Enter）'}
                    </button>
                    <button
                      type="button"
                      className="cloud-orders__btn-secondary"
                      onClick={() => setPage(prev => ({ ...prev, paymentDetailsOpen: true }))}
                      disabled={page.submitting}
                      data-testid="open-payment-details-button"
                    >
                      付款明細（E）
                    </button>
                    <button
                      type="button"
                      className="cloud-orders__btn-secondary"
                      onClick={handleCancelSelection}
                      disabled={page.submitting}
                    >
                      取消（Esc）
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* 右側：最近帳戶列表（U2a 定稿） */}
        <div className="cloud-orders__side-panel">
          <div className="cloud-orders__card" data-testid="recent-accounts-card">
            <h3>最近帳戶</h3>
            {recentAccounts.length === 0 ? (
              <p style={{ color: '#64748b' }}>今日尚無交易紀錄</p>
            ) : (
              <ul className="cloud-orders__recent-list" data-testid="recent-accounts-list">
                {recentAccounts.map(account => (
                  <li
                    key={account.studentId}
                    className="cloud-orders__recent-item"
                    onClick={() => {
                      const student = page.students.find(s => s.studentId === account.studentId);
                      if (student) handleSelectStudent(student);
                    }}
                    data-testid={`recent-item-${account.studentCode}`}
                  >
                    <span>
                      <strong>{account.studentCode}</strong> {account.displayName}
                    </span>
                    <span className="cloud-orders__recent-badge">{account.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* 重複訂餐確認 Modal */}
      {page.confirmDuplicateOpen && selectedStudent && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true">
          <div className="cloud-orders__modal">
            <h3>確認加訂餐點</h3>
            <p>
              {selectedStudent.displayName} 今天已訂過 {selectedStudentTodayOrders.length} 份餐點，
              確定要再加訂 1 份嗎？
            </p>
            <div className="cloud-orders__actions">
              <button
                type="button"
                className="cloud-orders__btn-primary"
                onClick={() => void executeSubmitOrder()}
                disabled={page.submitting}
                data-testid="confirm-duplicate-button"
              >
                {page.submitting ? '處理中...' : '確認加訂'}
              </button>
              <button
                type="button"
                className="cloud-orders__btn-secondary"
                onClick={() => setPage(prev => ({ ...prev, confirmDuplicateOpen: false }))}
                disabled={page.submitting}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 付款明細 Modal（E，依 U2a 定稿） */}
      {page.paymentDetailsOpen && selectedStudent && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true">
          <div className="cloud-orders__modal" data-testid="payment-details-modal">
            <h3>{selectedStudent.displayName} 今日付款明細</h3>
            {selectedStudentTodayOrders.length === 0 ? (
              <p style={{ color: '#64748b' }}>今日尚無交易紀錄</p>
            ) : (
              <table className="cloud-orders__table">
                <thead>
                  <tr>
                    <th>時間</th>
                    <th>項目</th>
                    <th>餐費</th>
                    <th>收款</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedStudentTodayOrders.map(tx => (
                    <tr key={tx.transactionId}>
                      <td>{formatTaipeiTime(timestampToISOString(tx.createdAt))}</td>
                      <td>
                        {tx.mealKind === 'bento'
                          ? `今日餐點：${tx.menuNameSnapshot || '排骨便當'}`
                          : `其他餐點：${tx.otherItemName || ''}`}
                      </td>
                      <td>${tx.mealPrice}</td>
                      <td>${tx.paidAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="cloud-orders__preview-bar" data-testid="payment-details-summary">
              <span>
                今日餐費：$
                {selectedStudentTodayOrders.reduce((sum, t) => sum + t.mealPrice, 0)}
              </span>
              <span>
                今日收款：$
                {selectedStudentTodayOrders.reduce((sum, t) => sum + t.paidAmount, 0)}
              </span>
              <span>帳戶餘額：${selectedStudent.currentBalance}</span>
            </div>

            <div className="cloud-orders__actions">
              <button
                type="button"
                className="cloud-orders__btn-secondary"
                onClick={() => setPage(prev => ({ ...prev, paymentDetailsOpen: false }))}
                data-testid="close-payment-details-button"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
