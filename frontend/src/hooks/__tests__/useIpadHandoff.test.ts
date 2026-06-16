import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock domain modules
vi.mock('../../domain/ipadHandoff', () => ({
  readHandoffIntent: vi.fn(),
  validateIpadHandoffMessage: vi.fn(),
  toHandoffScannerInput: vi.fn(),
}));
vi.mock('../../domain/posSearch', () => ({
  resolveScannedStudent: vi.fn(),
}));

import { useIpadHandoff } from '../useIpadHandoff';
import { readHandoffIntent, validateIpadHandoffMessage, toHandoffScannerInput } from '../../domain/ipadHandoff';
import { resolveScannedStudent } from '../../domain/posSearch';
import type { Student } from '../../domain/student';

const mockRead = vi.mocked(readHandoffIntent);
const mockValidate = vi.mocked(validateIpadHandoffMessage);
const mockToScanner = vi.mocked(toHandoffScannerInput);
const mockResolve = vi.mocked(resolveScannedStudent);

const students: Student[] = [
  { studentId: 'S001', displayName: '王小明', balance: 0, disabled: false, lastUpdatedAt: '', dailyLimit: 200 },
];

describe('#332 — useIpadHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:false when readHandoffIntent returns null', () => {
    mockRead.mockReturnValue(null);

    const dispatch = vi.fn();
    const { result } = renderHook(() => useIpadHandoff(dispatch, students));

    let res: Record<string, unknown> = {};
    act(() => {
      res = result.current.receiveIpadHandoff('test-channel');
    });

    expect(res).toEqual({ ok: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns ok:false when validation fails', () => {
    const msg = { studentId: '', action: 'select' };
    mockRead.mockReturnValue(msg as ReturnType<typeof readHandoffIntent>);
    mockValidate.mockReturnValue({ ok: false, error: 'missing studentId' } as ReturnType<typeof validateIpadHandoffMessage>);

    const dispatch = vi.fn();
    const { result } = renderHook(() => useIpadHandoff(dispatch, students));

    let res: Record<string, unknown> = {};
    act(() => {
      res = result.current.receiveIpadHandoff('test-channel');
    });

    expect(res).toEqual({ ok: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches selectStudent and returns ok:true when handoff resolves to one student', () => {
    const msg = { studentId: 'S001', action: 'select' };
    mockRead.mockReturnValue(msg as ReturnType<typeof readHandoffIntent>);
    mockValidate.mockReturnValue({ ok: true } as ReturnType<typeof validateIpadHandoffMessage>);
    mockToScanner.mockReturnValue({ raw: 'S001', source: 'ipad' } as ReturnType<typeof toHandoffScannerInput>);
    mockResolve.mockReturnValue({ ok: true, students: [students[0]] } as ReturnType<typeof resolveScannedStudent>);

    const dispatch = vi.fn();
    const { result } = renderHook(() => useIpadHandoff(dispatch, students));

    let res: Record<string, unknown> = {};
    act(() => {
      res = result.current.receiveIpadHandoff('test-channel');
    });

    expect(res).toEqual({ ok: true, studentId: 'S001' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'selectStudent',
      studentId: 'S001',
      source: 'ipad',
    });
  });
});
