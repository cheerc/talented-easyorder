export type PosMode = 'order' | 'payment' | 'expense';
export type PosSelectionSource = 'manual' | 'scan' | 'ipad';
export type PosSourceDevice = 'pc' | 'barcode_scanner' | 'ipad_handoff';

export type PosFlowState =
  | { kind: 'idle'; searchText: string }
  | { kind: 'student_selected'; studentId: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string; searchTextHint: string }
  | { kind: 'duplicate_warning'; studentId: string; source: PosSelectionSource; paidAmountText: string; searchTextHint: string }
  | { kind: 'expense_input'; amountText: string }
  | { kind: 'expense_direction'; amount: number }
  | { kind: 'expense_reason'; amount: number; direction: ExpenseDirection }
  | { kind: 'expense_other_note'; amount: number; direction: ExpenseDirection }
  | { kind: 'committing'; studentId?: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string; expenseAmount?: number; expenseNote?: string; expenseDirection?: ExpenseDirection }
  | { kind: 'success'; transactionId: string; syncStatus: 'queued' | 'synced' | 'failed' }
  | { kind: 'historical_readonly'; businessDate: string }
  | { kind: 'error'; studentId?: string; mode?: PosMode; source?: PosSelectionSource; paidAmountText?: string; message: string; retryable: boolean };

export type ExpenseDirection = 'income' | 'expense';

export type PosFlowEvent =
  | { type: 'updateSearchText'; text: string }
  | { type: 'selectStudent'; studentId: string; source: PosSelectionSource; searchTextHint?: string }
  | { type: 'changeMode'; mode: PosMode }
  | { type: 'updatePaidAmount'; text: string }
  | { type: 'requestCommit'; hasDuplicateOrder: boolean }
  | { type: 'confirmDuplicate' }
  | { type: 'enterExpenseMode' }
  | { type: 'expenseUpdateAmount'; text: string }
  | { type: 'expenseConfirmAmount'; amount: number }
  | { type: 'expenseSelectDirection'; direction: ExpenseDirection }
  | { type: 'expenseSelectReason'; reason: '付便當錢' | '支出其他' | '收入其他' }
  | { type: 'expenseUpdateNote'; note: string }
  | { type: 'expenseConfirmNote' }
  | { type: 'commitStarted' }
  | { type: 'commitSucceeded'; transactionId: string; syncStatus: 'queued' | 'synced' | 'failed' }
  | { type: 'commitFailed'; message: string; retryable: boolean }
  | { type: 'dismissSuccess' }
  | { type: 'cancel' }
  | { type: 'enterHistoricalReadonly'; businessDate: string };

export function createInitialPosFlowState(isHistorical: boolean, businessDate: string): PosFlowState {
  if (isHistorical) return { kind: 'historical_readonly', businessDate };
  return { kind: 'idle', searchText: '' };
}

export function reducePosFlow(state: PosFlowState, event: PosFlowEvent): PosFlowState {
  switch (state.kind) {
    case 'idle':
      return reduceIdle(state, event);
    case 'student_selected':
      return reduceStudentSelected(state, event);
    case 'duplicate_warning':
      return reduceDuplicateWarning(state, event);
    case 'expense_input':
      return reduceExpenseInput(state, event);
    case 'expense_direction':
      return reduceExpenseDirection(state, event);
    case 'expense_reason':
      return reduceExpenseReason(state, event);
    case 'expense_other_note':
      return reduceExpenseOtherNote(state, event);
    case 'committing':
      return reduceCommitting(state, event);
    case 'success':
      return reduceSuccess(state, event);
    case 'error':
      return reduceError(state, event);
    case 'historical_readonly':
      return state;
  }
}

function reduceIdle(state: PosFlowState & { kind: 'idle' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'updateSearchText':
      return { kind: 'idle', searchText: event.text };
    case 'selectStudent':
      return { kind: 'student_selected', studentId: event.studentId, mode: 'order', source: event.source, paidAmountText: '', searchTextHint: '' };
    case 'enterExpenseMode':
      return { kind: 'expense_input', amountText: '' };
    default:
      return state;
  }
}

function reduceStudentSelected(state: PosFlowState & { kind: 'student_selected' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'changeMode': {
      if (event.mode === state.mode) return state;
      return { ...state, mode: event.mode, paidAmountText: '' };
    }
    case 'updatePaidAmount':
      return { ...state, paidAmountText: event.text };
    case 'requestCommit': {
      if (state.mode === 'order' && event.hasDuplicateOrder) {
        return { kind: 'duplicate_warning', studentId: state.studentId, source: state.source, paidAmountText: state.paidAmountText, searchTextHint: state.searchTextHint };
      }
      return { kind: 'committing', studentId: state.studentId, mode: state.mode, source: state.source, paidAmountText: state.paidAmountText };
    }
    case 'selectStudent':
      return { kind: 'student_selected', studentId: event.studentId, mode: 'order', source: event.source, paidAmountText: '', searchTextHint: event.searchTextHint ?? '' };
    case 'cancel':
      return { kind: 'idle', searchText: state.searchTextHint };
    default:
      return state;
  }
}

function reduceDuplicateWarning(state: PosFlowState & { kind: 'duplicate_warning' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'confirmDuplicate':
      return { kind: 'committing', studentId: state.studentId, mode: 'order', source: state.source, paidAmountText: state.paidAmountText };
    case 'cancel':
      return { kind: 'idle', searchText: state.searchTextHint };
    default:
      return state;
  }
}

function reduceExpenseInput(state: PosFlowState & { kind: 'expense_input' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'expenseUpdateAmount':
      return { kind: 'expense_input', amountText: event.text };
    case 'expenseConfirmAmount':
      return { kind: 'expense_direction', amount: event.amount };
    case 'cancel':
      return { kind: 'idle', searchText: '' };
    default:
      return state;
  }
}

function reduceExpenseDirection(state: PosFlowState & { kind: 'expense_direction' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'expenseSelectDirection':
      return { kind: 'expense_reason', amount: state.amount, direction: event.direction };
    case 'cancel':
      return { kind: 'idle', searchText: '' };
    default:
      return state;
  }
}

function reduceExpenseReason(state: PosFlowState & { kind: 'expense_reason' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'expenseSelectReason': {
      if (event.reason === '付便當錢') {
        return { kind: 'committing', mode: 'expense', source: 'manual', paidAmountText: '', expenseAmount: state.amount, expenseNote: '付便當錢', expenseDirection: 'expense' };
      }
      if (event.reason === '收入其他') {
        return { kind: 'expense_other_note', amount: state.amount, direction: 'income' };
      }
      return { kind: 'expense_other_note', amount: state.amount, direction: 'expense' };
    }
    case 'cancel':
      return { kind: 'idle', searchText: '' };
    default:
      return state;
  }
}

function reduceExpenseOtherNote(state: PosFlowState & { kind: 'expense_other_note' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'expenseUpdateNote':
      return { kind: 'expense_other_note', amount: state.amount, direction: state.direction };
    case 'expenseConfirmNote':
      return { kind: 'committing', mode: 'expense', source: 'manual', paidAmountText: '', expenseAmount: state.amount, expenseNote: event.note, expenseDirection: state.direction };
    case 'cancel':
      return { kind: 'idle', searchText: '' };
    default:
      return state;
  }
}

function reduceCommitting(state: PosFlowState & { kind: 'committing' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'commitSucceeded':
      return { kind: 'success', transactionId: event.transactionId, syncStatus: event.syncStatus };
    case 'commitFailed':
      return {
        kind: 'error',
        studentId: state.studentId,
        mode: state.mode,
        source: state.source,
        paidAmountText: state.paidAmountText,
        message: event.message,
        retryable: event.retryable,
      };
    default:
      return state;
  }
}

function reduceSuccess(state: PosFlowState & { kind: 'success' }, event: PosFlowEvent): PosFlowState {
  if (event.type === 'dismissSuccess') return { kind: 'idle', searchText: '' };
  return state;
}

function reduceError(state: PosFlowState & { kind: 'error' }, event: PosFlowEvent): PosFlowState {
  if (event.type === 'cancel') return { kind: 'idle', searchText: '' };
  return state;
}

export function toPosSourceDevice(source: PosSelectionSource): PosSourceDevice {
  switch (source) {
    case 'manual':
      return 'pc';
    case 'scan':
      return 'barcode_scanner';
    case 'ipad':
      return 'ipad_handoff';
  }
}
