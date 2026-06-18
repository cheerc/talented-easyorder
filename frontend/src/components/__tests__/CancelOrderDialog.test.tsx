import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CancelOrderDialog } from '../CancelOrderDialog';
import type { StudentAccount } from '../../domain/student';
import type { LedgerTransaction } from '../../domain/ledger';

const mockStudent: StudentAccount = {
  studentId: 's-1',
  displayName: '王小明',
  currentBalance: 500,
  schoolId: 'school-1',
  classLabel: 'A',
  enrollmentStatus: 'active',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const mockOrderTxWithPaidAmount: LedgerTransaction = {
  transactionId: 'tx-1',
  studentId: 's-1',
  studentNameSnapshot: '王小明',
  type: 'order',
  businessDate: '2026-06-18',
  mealPrice: 85,
  paidAmount: 90,
  amount: -85,
  note: '今日便當',
  syncStatus: 'local',
  createdAt: '2026-06-18T10:00:00Z',
  updatedAt: '2026-06-18T10:00:00Z',
  operatorId: 'op-1',
};

const mockOrderTxNoPaid: LedgerTransaction = {
  ...mockOrderTxWithPaidAmount,
  paidAmount: 0,
};

describe('CancelOrderDialog keyboard navigation', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn();
    onCancel = vi.fn();
  });

  describe('with paid amount (refund options visible)', () => {
    function renderWithRefund() {
      return render(
        <CancelOrderDialog
          open={true}
          picked={mockStudent}
          orderTx={mockOrderTxWithPaidAmount}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    }

    it('ArrowDown switches from "退還現金" to "保留至帳戶餘額"', () => {
      renderWithRefund();
      // Default should be "退還現金" (keepPaymentAsDeposit=false)
      const radios = screen.getAllByRole('radio');
      expect(radios[0]).toBeChecked(); // 退還現金
      expect(radios[1]).not.toBeChecked(); // 保留至帳戶餘額

      fireEvent.keyDown(window, { key: 'ArrowDown' });

      expect(radios[0]).not.toBeChecked();
      expect(radios[1]).toBeChecked();
    });

    it('ArrowUp switches from "保留至帳戶餘額" back to "退還現金"', () => {
      renderWithRefund();
      // Press ArrowDown first to select "保留至帳戶餘額"
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      const radios = screen.getAllByRole('radio');
      expect(radios[1]).toBeChecked();

      fireEvent.keyDown(window, { key: 'ArrowUp' });

      expect(radios[0]).toBeChecked();
      expect(radios[1]).not.toBeChecked();
    });

    it('ArrowDown at bottom does not go past the last option', () => {
      renderWithRefund();
      // Press ArrowDown twice — should stay on second option
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });

      const radios = screen.getAllByRole('radio');
      expect(radios[1]).toBeChecked();
    });

    it('ArrowUp at top does not go past the first option', () => {
      renderWithRefund();
      // Already at first option, pressing ArrowUp should stay
      fireEvent.keyDown(window, { key: 'ArrowUp' });

      const radios = screen.getAllByRole('radio');
      expect(radios[0]).toBeChecked();
    });

    it('Enter confirms with current selection (default: keepPaymentAsDeposit=false)', () => {
      renderWithRefund();
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledWith(false);
    });

    it('Enter confirms with keepPaymentAsDeposit=true after ArrowDown', () => {
      renderWithRefund();
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledWith(true);
    });
  });

  describe('without paid amount (simple confirm)', () => {
    function renderSimple() {
      return render(
        <CancelOrderDialog
          open={true}
          picked={mockStudent}
          orderTx={mockOrderTxNoPaid}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    }

    it('Enter confirms with keepPaymentAsDeposit=false', () => {
      renderSimple();
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledWith(false);
    });

    it('ArrowDown/ArrowUp do nothing when no refund options', () => {
      renderSimple();
      // No radio buttons should exist
      expect(screen.queryAllByRole('radio')).toHaveLength(0);

      // Arrow keys should not throw
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
  });

  describe('when dialog is closed', () => {
    it('keyboard events are not handled', () => {
      render(
        <CancelOrderDialog
          open={false}
          picked={mockStudent}
          orderTx={mockOrderTxWithPaidAmount}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Escape still works (via Modal)', () => {
    it('Escape calls onCancel through Modal onClose', () => {
      render(
        <CancelOrderDialog
          open={true}
          picked={mockStudent}
          orderTx={mockOrderTxWithPaidAmount}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
