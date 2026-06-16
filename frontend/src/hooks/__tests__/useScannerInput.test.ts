import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScannerInput } from '../useScannerInput';
import type { StudentAccount } from '../../domain/student';

const students: StudentAccount[] = [
  { studentId: 'S001', displayName: '王小明', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '', updatedAt: '', revision: 1 },
  { studentId: 'S002', displayName: '李小花', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '', updatedAt: '', revision: 1 },
];

describe('#332 — useScannerInput', () => {
  it('dispatches selectStudent when scan matches exactly one student', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScannerInput(dispatch, students));

    act(() => {
      result.current.receiveScannerInput({ rawCode: 'S001', terminator: 'Enter' });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'selectStudent',
      studentId: 'S001',
      source: 'scan',
    });
  });

  it('does not dispatch when scan matches no student', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScannerInput(dispatch, students));

    act(() => {
      result.current.receiveScannerInput({ rawCode: 'UNKNOWN', terminator: 'Enter' });
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch for inactive students', () => {
    const inactiveStudents: StudentAccount[] = [
      { studentId: 'S003', displayName: '張三', status: 'inactive', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '', updatedAt: '', revision: 1 },
    ];
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScannerInput(dispatch, inactiveStudents));

    act(() => {
      result.current.receiveScannerInput({ rawCode: 'S003', terminator: 'Enter' });
    });

    expect(dispatch).not.toHaveBeenCalled();
  });
});
