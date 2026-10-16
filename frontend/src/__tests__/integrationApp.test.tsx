/**
 * 完整 App 跨功能整合與真實 persist 測試（端到端 UI 時窗與 Storage 回歸）
 *
 * 涵蓋 ac 驗收收據要求：
 * 1. 完整 App 實際從 F3 編輯停用帳戶改號、直接退款、退款框 modal guard、F5 查詢與離頁 target 清除；
 *    真實 storage reader 驗證 persist.rehydrate() 與重載後掛載 App 仍能顯示更新後的餘額與退款紀錄。
 * 2. 改號退款後，在 F1 介面點擊真實「撤回」按鈕，交易撤回、餘額回復。
 * 3. 改號退款後，撤回按鈕在真實倒數 5 秒後消失，退款及餘額保留。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import App from '../App';
import { usePosStore } from '../store/posStore';
import type { PosState } from '../store/posTypes';
import { createPosPersistenceConfig } from '../store/posPersistence';
import { createLocalAccount } from '../domain/student';
import { describeAuditEvents, matchesAuditQuery } from '../domain/auditView';

vi.mock('../appMode', async (original) => ({
  ...(await original()),
  isPrototypeMode: true,
}));

vi.mock('../firebase/firebaseApp', () => ({
  ensureFirebaseInitialized: () => Promise.resolve(null),
  isFirebaseConfigured: () => false,
  isConfigured: false,
  readFirebaseConfig: () => ({}),
  getFirebaseConfigState: () => ({ configured: false, error: '' }),
}));

beforeEach(async () => {
  localStorage.clear();
  await usePosStore.persist.rehydrate();
  usePosStore.getState().startBlankData();
  const student = createLocalAccount(
    { studentId: '005', displayName: '整合甲', openingBalance: 300, openingNote: '期初', asOfDate: '2026-10-16' },
    '2026-10-16T00:00:00Z'
  );
  const other = createLocalAccount(
    { studentId: '0090', displayName: '整合乙', openingBalance: 50, openingNote: '期初', asOfDate: '2026-10-16' },
    '2026-10-16T00:00:00Z'
  );
  usePosStore.setState({
    simulationDate: '2026-10-16',
    students: [{ ...student, status: 'inactive' }, other],
    transactions: [],
    auditEvents: [],
    businessDateStatuses: {},
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renameInApp() {
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /今日設定/ }));
  await user.click(await screen.findByRole('button', { name: '編輯 005' }));
  const form = screen.getByRole('form', { name: '編輯帳戶 005' });
  await user.clear(within(form).getByLabelText('帳戶編號'));
  await user.type(within(form).getByLabelText('帳戶編號'), '009');
  await user.type(within(form).getByLabelText('改號理由'), '整合改號');
  await user.click(within(form).getByRole('button', { name: '儲存' }));
  await user.click(screen.getByRole('button', { name: '確認改號' }));
  await screen.findByRole('button', { name: '退款 009' });
  expect(usePosStore.getState().students.find(s => s.studentId === '009')).toMatchObject({
    status: 'inactive',
    currentBalance: 300,
  });
  return user;
}

async function refundInApp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '退款 009' }));
  await screen.findByRole('dialog', { name: '退款給學生' });
  for (const key of ['q', 'w', 'e', '{F1}', '{F2}', '{F3}', '{F5}', '{ArrowRight}', '{Enter}']) {
    await user.keyboard(key);
    expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy();
    expect(usePosStore.getState().transactions).toHaveLength(0);
  }
  await user.clear(screen.getByLabelText('退款金額'));
  await user.type(screen.getByLabelText('退款金額'), '120');
  await user.type(screen.getByLabelText('退款理由'), '整合離班退款');
  await user.click(screen.getByRole('button', { name: '確認退款' }));
  await waitFor(() => expect(usePosStore.getState().transactions).toHaveLength(1));
  expect(usePosStore.getState().transactions[0]).toMatchObject({
    studentId: '009',
    type: 'refund',
    amount: 120,
    mealPrice: 0,
    paidAmount: 0,
  });
  expect(usePosStore.getState().students.find(s => s.studentId === '009')?.currentBalance).toBe(180);
}

describe('完整 App 跨功能整合與真實 Persist 測試', () => {
  it('完整 App F3 停用改號後退款、精確 F5 與離開後 target 清除、真實 storage 新 reader 重載', async () => {
    const user = await renameInApp();
    await refundInApp(user);
    await user.click(screen.getByRole('button', { name: '交易紀錄 009' }));
    const query = (await screen.findByLabelText('查詢帳戶')) as HTMLInputElement;
    expect(query.value).toBe('009');
    expect(screen.getByRole('note').textContent).toContain('009 整合甲');
    expect(screen.getByRole('note').textContent).not.toContain('整合乙');
    expect(document.body.textContent).toContain('整合離班退款');
    await user.keyboard('{F1}');
    await user.keyboard('{F5}');
    await waitFor(() => expect(screen.queryByLabelText('查詢帳戶')).toBeNull());
    expect(screen.getByText('結帳歷史')).toHaveClass('tab-on');
    cleanup();

    const config = createPosPersistenceConfig();
    expect(config.name).toBe(usePosStore.persist.getOptions().name);
    const saved = (await config.storage!.getItem(config.name)) as {
      state: {
        students: Array<{ studentId: string; currentBalance: number }>;
        auditEvents: Array<{ eventType: string }>;
      };
    };
    expect(saved.state.students.find(s => s.studentId === '009')?.currentBalance).toBe(180);
    expect(saved.state.auditEvents.some(e => e.eventType === 'student_code_changed')).toBe(true);

    const reader = createStore<PosState>()(
      persist(() => ({ ...usePosStore.getInitialState(), students: [], transactions: [], auditEvents: [] }), {
        ...config,
        skipHydration: true,
      })
    );
    await reader.persist.rehydrate();
    expect(reader.persist.hasHydrated()).toBe(true);
    expect(reader.getState().students).toEqual(usePosStore.getState().students);
    expect(reader.getState().transactions).toEqual(usePosStore.getState().transactions);
    expect(reader.getState().auditEvents).toEqual(usePosStore.getState().auditEvents);

    const state = reader.getState();
    const rows = describeAuditEvents(state.auditEvents, state.transactions, state.students);
    expect(rows.some(r => matchesAuditQuery(r, '005'))).toBe(true);
    expect(rows.some(r => matchesAuditQuery(r, '009') && r.reason === '整合改號')).toBe(true);

    // 模擬頁面重新建立記憶體：只在清空記憶體時暫停寫入，保留真實 storage 內容
    const originalStorage = usePosStore.persist.getOptions().storage;
    usePosStore.persist.setOptions({ storage: { ...originalStorage, setItem: async () => {} } as typeof originalStorage });
    usePosStore.setState(usePosStore.getInitialState(), true);
    expect(usePosStore.getState().students.some(s => s.studentId === '009' && s.displayName === '整合甲')).toBe(false);
    usePosStore.persist.setOptions({ storage: originalStorage });
    await usePosStore.persist.rehydrate();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /今日設定/ }));
    await user.click(await screen.findByRole('button', { name: '交易紀錄 009' }));
    expect(((await screen.findByLabelText('查詢帳戶')) as HTMLInputElement).value).toBe('009');
    expect(screen.getByRole('note').textContent).toContain('現在餘額 $180');
    expect(document.body.textContent).toContain('整合離班退款');
  });

  it('完整 App F3 改號退款後以實際撤回按鈕恢復餘額', async () => {
    const user = await renameInApp();
    await refundInApp(user);
    await user.keyboard('{F1}');
    const undo = await screen.findByRole('button', { name: /撤回/ });
    await user.click(undo);
    expect(usePosStore.getState().transactions).toHaveLength(0);
    expect(usePosStore.getState().students.find(s => s.studentId === '009')?.currentBalance).toBe(300);
    expect(document.querySelector('.flash')).toBeNull();
  });

  it('完整 App 改號退款後撤回按鈕倒數 5 秒消失，退款仍保留', async () => {
    const user = await renameInApp();
    await refundInApp(user);
    await user.keyboard('{F1}');
    await screen.findByRole('button', { name: /撤回/ });
    // 使用真實時間，驗證實際 effect / countdown，不直接呼叫 deleteTransaction
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /撤回/ })).toBeNull(),
      { timeout: 7000, interval: 100 }
    );
    expect(usePosStore.getState().transactions).toHaveLength(1);
    expect(usePosStore.getState().students.find(s => s.studentId === '009')?.currentBalance).toBe(180);
  }, 15000);
});
