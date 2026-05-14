export type PosMode = 'order' | 'topup' | 'cancel';
export type PosSelectionSource = 'manual' | 'scan' | 'ipad';
export type PosSourceDevice = 'pc' | 'barcode_scanner' | 'ipad_handoff';

export type PosFlowState =
  | { kind: 'idle'; searchText: string }
  | { kind: 'student_selected'; studentId: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string }
  | { kind: 'duplicate_warning'; studentId: string; source: PosSelectionSource; paidAmountText: string }
  | { kind: 'committing'; studentId: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string }
  | { kind: 'success'; transactionId: string; syncStatus: 'queued' | 'synced' | 'failed' }
  | { kind: 'historical_readonly'; businessDate: string }
  | { kind: 'error'; studentId?: string; mode?: PosMode; source?: PosSelectionSource; paidAmountText?: string; message: string; retryable: boolean };

export type PosFlowEvent =
  | { type: 'updateSearchText'; text: string }
  | { type: 'selectStudent'; studentId: string; source: PosSelectionSource }
  | { type: 'changeMode'; mode: PosMode; cancelAvailable: boolean }
  | { type: 'updatePaidAmount'; text: string }
  | { type: 'requestCommit'; hasDuplicateOrder: boolean; cancelAvailable: boolean }
  | { type: 'confirmDuplicate' }
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
      return { kind: 'student_selected', studentId: event.studentId, mode: 'order', source: event.source, paidAmountText: '' };
    default:
      return state;
  }
}

function reduceStudentSelected(state: PosFlowState & { kind: 'student_selected' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'changeMode': {
      if (event.mode === state.mode) return state;
      if (event.mode === 'cancel' && !event.cancelAvailable) return state;
      if (event.mode === 'cancel') return { ...state, mode: 'cancel' };
      return { ...state, mode: event.mode };
    }
    case 'updatePaidAmount':
      return { ...state, paidAmountText: event.text };
    case 'requestCommit': {
      if (state.mode === 'order' && event.hasDuplicateOrder) {
        return { kind: 'duplicate_warning', studentId: state.studentId, source: state.source, paidAmountText: state.paidAmountText };
      }
      return { kind: 'committing', studentId: state.studentId, mode: state.mode, source: state.source, paidAmountText: state.paidAmountText };
    }
    case 'selectStudent':
      return { kind: 'student_selected', studentId: event.studentId, mode: 'order', source: event.source, paidAmountText: '' };
    case 'cancel':
      return { kind: 'idle', searchText: '' };
    default:
      return state;
  }
}

function reduceDuplicateWarning(state: PosFlowState & { kind: 'duplicate_warning' }, event: PosFlowEvent): PosFlowState {
  switch (event.type) {
    case 'confirmDuplicate':
      return { kind: 'committing', studentId: state.studentId, mode: 'order', source: state.source, paidAmountText: state.paidAmountText };
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
