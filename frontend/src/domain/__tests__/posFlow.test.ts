import { describe, it, expect } from 'vitest';
import {
  createInitialPosFlowState,
  reducePosFlow,
  toPosSourceDevice,
} from '../posFlow';
import type { PosFlowState, PosFlowEvent } from '../posFlow';

describe('createInitialPosFlowState', () => {
  it('creates idle state for current business date', () => {
    const state = createInitialPosFlowState(false, '2026-05-07');
    expect(state).toEqual({ kind: 'idle', searchText: '' });
  });

  it('creates historical_readonly state for past business date', () => {
    const state = createInitialPosFlowState(true, '2026-05-01');
    expect(state).toEqual({ kind: 'historical_readonly', businessDate: '2026-05-01' });
  });
});

describe('reducePosFlow — idle state transitions', () => {
  const idle: PosFlowState = { kind: 'idle', searchText: '' };

  it('idle + updateSearchText updates text in idle', () => {
    const event: PosFlowEvent = { type: 'updateSearchText', text: '001' };
    const result = reducePosFlow(idle, event);
    expect(result).toEqual({ kind: 'idle', searchText: '001' });
  });

  it('idle + selectStudent via manual goes to student_selected with order mode', () => {
    const event: PosFlowEvent = { type: 'selectStudent', studentId: '001', source: 'manual' };
    expect(reducePosFlow(idle, event)).toEqual({
      kind: 'student_selected',
      studentId: '001',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
    });
  });

  it('idle + selectStudent via scan sets source correctly', () => {
    const event: PosFlowEvent = { type: 'selectStudent', studentId: '002', source: 'scan' };
    expect(reducePosFlow(idle, event)).toEqual({
      kind: 'student_selected',
      studentId: '002',
      mode: 'order',
      source: 'scan',
      paidAmountText: '',
    });
  });

  it('idle + selectStudent via ipad sets source correctly', () => {
    const event: PosFlowEvent = { type: 'selectStudent', studentId: '003', source: 'ipad' };
    expect(reducePosFlow(idle, event)).toEqual({
      kind: 'student_selected',
      studentId: '003',
      mode: 'order',
      source: 'ipad',
      paidAmountText: '',
    });
  });

  it('idle + commit-related events are ignored', () => {
    const events: PosFlowEvent[] = [
      { type: 'requestCommit', hasDuplicateOrder: false, cancelAvailable: false },
      { type: 'commitStarted' },
      { type: 'commitSucceeded', transactionId: 'x', syncStatus: 'queued' },
      { type: 'commitFailed', message: 'err', retryable: false },
      { type: 'dismissSuccess' },
    ];
    for (const ev of events) {
      expect(reducePosFlow(idle, ev)).toEqual(idle);
    }
  });
});

describe('reducePosFlow — student_selected transitions', () => {
  const selected: PosFlowState = {
    kind: 'student_selected',
    studentId: '001',
    mode: 'order',
    source: 'manual',
    paidAmountText: '',
    searchTextHint: '',
  };

  it('changeMode(order) stays selected', () => {
    const event: PosFlowEvent = { type: 'changeMode', mode: 'order', cancelAvailable: false };
    expect(reducePosFlow(selected, event)).toEqual(selected);
  });

  it('changeMode(cancel) when cancelAvailable=true stays selected with cancel mode', () => {
    const event: PosFlowEvent = { type: 'changeMode', mode: 'cancel', cancelAvailable: true };
    expect(reducePosFlow(selected, event)).toEqual({ ...selected, mode: 'cancel', searchTextHint: '' });
  });

  it('changeMode(cancel) when cancelAvailable=false returns unchanged', () => {
    const event: PosFlowEvent = { type: 'changeMode', mode: 'cancel', cancelAvailable: false };
    expect(reducePosFlow(selected, event)).toEqual(selected);
  });

  it('updatePaidAmount updates text', () => {
    const event: PosFlowEvent = { type: 'updatePaidAmount', text: '100' };
    expect(reducePosFlow(selected, event)).toEqual({ ...selected, paidAmountText: '100' });
  });

  it('cancel returns idle with empty search', () => {
    const event: PosFlowEvent = { type: 'cancel' };
    expect(reducePosFlow(selected, event)).toEqual({ kind: 'idle', searchText: '' });
  });

  it('requestCommit with order and hasDuplicateOrder=true goes to duplicate_warning', () => {
    const event: PosFlowEvent = { type: 'requestCommit', hasDuplicateOrder: true, cancelAvailable: false };
    expect(reducePosFlow(selected, event)).toEqual({
      kind: 'duplicate_warning',
      studentId: '001',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
    });
  });

  it('requestCommit with order and hasDuplicateOrder=false goes to committing', () => {
    const event: PosFlowEvent = { type: 'requestCommit', hasDuplicateOrder: false, cancelAvailable: false };
    expect(reducePosFlow(selected, event)).toEqual({
      kind: 'committing',
      studentId: '001',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
    });
  });

  it('selectStudent during selected replaces the student', () => {
    const event: PosFlowEvent = { type: 'selectStudent', studentId: '002', source: 'manual' };
    expect(reducePosFlow(selected, event)).toEqual({
      kind: 'student_selected',
      studentId: '002',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
    });
  });

  it('updateSearchText updates search but stays in same state', () => {
    const event: PosFlowEvent = { type: 'updateSearchText', text: 'abc' };
    expect(reducePosFlow(selected, event)).toEqual(selected);
  });
});

describe('reducePosFlow — duplicate_warning transitions', () => {
  const warning: PosFlowState = {
    kind: 'duplicate_warning',
    studentId: '001',
    source: 'manual',
    paidAmountText: '',
    searchTextHint: '',
  };

  it('confirmDuplicate goes to committing', () => {
    expect(reducePosFlow(warning, { type: 'confirmDuplicate' })).toEqual({
      kind: 'committing',
      studentId: '001',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
    });
  });

  it('cancel returns idle', () => {
    expect(reducePosFlow(warning, { type: 'cancel' })).toEqual({ kind: 'idle', searchText: '' });
  });
});

describe('reducePosFlow — committing guards', () => {
  const committing: PosFlowState = {
    kind: 'committing',
    studentId: '001',
    mode: 'order',
    source: 'manual',
    paidAmountText: '',
  };

  it('requestCommit during committing returns unchanged (duplicate-submit guard)', () => {
    const event: PosFlowEvent = { type: 'requestCommit', hasDuplicateOrder: false, cancelAvailable: false };
    expect(reducePosFlow(committing, event)).toEqual(committing);
  });

  it('changeMode during committing returns unchanged', () => {
    expect(reducePosFlow(committing, { type: 'changeMode', mode: 'topup', cancelAvailable: false })).toEqual(committing);
  });

  it('selectStudent during committing returns unchanged', () => {
    expect(reducePosFlow(committing, { type: 'selectStudent', studentId: '002', source: 'manual' })).toEqual(committing);
  });

  it('commitSucceeded goes to success', () => {
    expect(reducePosFlow(committing, { type: 'commitSucceeded', transactionId: 'tx-1', syncStatus: 'queued' })).toEqual({
      kind: 'success',
      transactionId: 'tx-1',
      syncStatus: 'queued',
    });
  });

  it('commitFailed goes to error preserving context', () => {
    const result = reducePosFlow(committing, { type: 'commitFailed', message: 'network error', retryable: true });
    expect(result).toEqual({
      kind: 'error',
      studentId: '001',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
      message: 'network error',
      retryable: true,
    });
  });

  it('cancel during committing returns unchanged', () => {
    expect(reducePosFlow(committing, { type: 'cancel' })).toEqual(committing);
  });
});

describe('reducePosFlow — success transitions', () => {
  const success: PosFlowState = {
    kind: 'success',
    transactionId: 'tx-1',
    syncStatus: 'queued',
  };

  it('dismissSuccess returns idle', () => {
    expect(reducePosFlow(success, { type: 'dismissSuccess' })).toEqual({ kind: 'idle', searchText: '' });
  });

  it('other events ignored during success', () => {
    expect(reducePosFlow(success, { type: 'cancel' })).toEqual(success);
    expect(reducePosFlow(success, { type: 'requestCommit', hasDuplicateOrder: false, cancelAvailable: false })).toEqual(success);
  });
});

describe('reducePosFlow — error transitions', () => {
  const errorWithContext: PosFlowState = {
    kind: 'error',
    studentId: '001',
    mode: 'order',
    source: 'manual',
    paidAmountText: '50',
    message: 'save failed',
    retryable: true,
  };

  it('cancel from error returns idle', () => {
    expect(reducePosFlow(errorWithContext, { type: 'cancel' })).toEqual({ kind: 'idle', searchText: '' });
  });

  it('requestCommit from error returns unchanged', () => {
    expect(reducePosFlow(errorWithContext, { type: 'requestCommit', hasDuplicateOrder: false, cancelAvailable: false })).toEqual(errorWithContext);
  });

  it('preserves context for non-retryable error too', () => {
    const nonRetryable: PosFlowState = { ...errorWithContext, retryable: false };
    expect(reducePosFlow(nonRetryable, { type: 'cancel' })).toEqual({ kind: 'idle', searchText: '' });
  });
});

describe('reducePosFlow — historical_readonly lock', () => {
  const hist: PosFlowState = { kind: 'historical_readonly', businessDate: '2026-05-01' };

  it('selectStudent ignored', () => {
    expect(reducePosFlow(hist, { type: 'selectStudent', studentId: '001', source: 'manual' })).toEqual(hist);
  });

  it('changeMode ignored', () => {
    expect(reducePosFlow(hist, { type: 'changeMode', mode: 'order', cancelAvailable: false })).toEqual(hist);
  });

  it('updatePaidAmount ignored', () => {
    expect(reducePosFlow(hist, { type: 'updatePaidAmount', text: '100' })).toEqual(hist);
  });

  it('requestCommit ignored', () => {
    expect(reducePosFlow(hist, { type: 'requestCommit', hasDuplicateOrder: false, cancelAvailable: false })).toEqual(hist);
  });

  it('cancel ignored', () => {
    expect(reducePosFlow(hist, { type: 'cancel' })).toEqual(hist);
  });

  it('updateSearchText ignored', () => {
    expect(reducePosFlow(hist, { type: 'updateSearchText', text: '001' })).toEqual(hist);
  });
});

describe('toPosSourceDevice', () => {
  it('maps manual -> pc', () => expect(toPosSourceDevice('manual')).toBe('pc'));
  it('maps scan -> barcode_scanner', () => expect(toPosSourceDevice('scan')).toBe('barcode_scanner'));
  it('maps ipad -> ipad_handoff', () => expect(toPosSourceDevice('ipad')).toBe('ipad_handoff'));
});
