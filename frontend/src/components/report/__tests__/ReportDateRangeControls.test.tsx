import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ReportDateRangeControls } from '../ReportDateRangeControls';
import type { LedgerDateRangeKind } from '../../domain/ledgerReport';

const baseProps = {
  dateRange: 'today' as LedgerDateRangeKind,
  setDateRange: vi.fn(),
  todayStr: '5/30',
  txCount: 42,
  customStart: '2026-05-01',
  customEnd: '2026-05-30',
  setCustomStart: vi.fn(),
  setCustomEnd: vi.fn(),
};

describe('ReportDateRangeControls', () => {
  it('renders 4 date range buttons', () => {
    const { container } = render(<ReportDateRangeControls {...baseProps} />);
    const btns = container.querySelectorAll('.rpt-date');
    expect(btns.length).toBe(4);
  });

  it('active button has rpt-on class', () => {
    const { container } = render(<ReportDateRangeControls {...baseProps} dateRange="today" />);
    const active = container.querySelector('.rpt-date.rpt-on');
    expect(active).toBeTruthy();
    expect(active!.textContent).toContain('5/30');
  });

  it('calls setDateRange with correct id on button click', () => {
    const setDateRange = vi.fn();
    const { getByText } = render(
      <ReportDateRangeControls {...baseProps} setDateRange={setDateRange} />
    );
    fireEvent.click(getByText('本週'));
    expect(setDateRange).toHaveBeenCalledWith('week');
  });

  it('shows custom date inputs when dateRange is custom', () => {
    const { container } = render(<ReportDateRangeControls {...baseProps} dateRange="custom" />);
    const inputs = container.querySelectorAll('input[type="date"]');
    expect(inputs.length).toBe(2);
  });

  it('does not show custom inputs when dateRange is today', () => {
    const { container } = render(<ReportDateRangeControls {...baseProps} dateRange="today" />);
    const inputs = container.querySelectorAll('input[type="date"]');
    expect(inputs.length).toBe(0);
  });

  it('calls setCustomStart on custom start input change', () => {
    const setCustomStart = vi.fn();
    const { container } = render(
      <ReportDateRangeControls {...baseProps} dateRange="custom" setCustomStart={setCustomStart} />
    );
    const startInput = container.querySelectorAll('input[type="date"]')[0];
    fireEvent.change(startInput, { target: { value: '2026-05-15' } });
    expect(setCustomStart).toHaveBeenCalledWith('2026-05-15');
  });

  it('calls setCustomEnd on custom end input change', () => {
    const setCustomEnd = vi.fn();
    const { container } = render(
      <ReportDateRangeControls {...baseProps} dateRange="custom" setCustomEnd={setCustomEnd} />
    );
    const endInput = container.querySelectorAll('input[type="date"]')[1];
    fireEvent.change(endInput, { target: { value: '2026-05-28' } });
    expect(setCustomEnd).toHaveBeenCalledWith('2026-05-28');
  });

  it('shows tx count in today mode', () => {
    const { container } = render(<ReportDateRangeControls {...baseProps} txCount={99} />);
    expect(container.textContent).toContain('99 筆交易');
  });
});
