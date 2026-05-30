import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ExportActions } from '../ExportActions';

describe('ExportActions', () => {
  it('renders 列印 and 匯出 CSV buttons', () => {
    const { getByText } = render(<ExportActions onExportCsv={vi.fn()} onPrint={vi.fn()} />);
    expect(getByText('列印')).toBeTruthy();
    expect(getByText('匯出 CSV')).toBeTruthy();
  });

  it('calls onPrint when 列印 clicked', () => {
    const onPrint = vi.fn();
    const { getByText } = render(<ExportActions onExportCsv={vi.fn()} onPrint={onPrint} />);
    fireEvent.click(getByText('列印'));
    expect(onPrint).toHaveBeenCalledOnce();
  });

  it('calls onExportCsv when 匯出 CSV clicked', () => {
    const onExportCsv = vi.fn();
    const { getByText } = render(<ExportActions onExportCsv={onExportCsv} onPrint={vi.fn()} />);
    fireEvent.click(getByText('匯出 CSV'));
    expect(onExportCsv).toHaveBeenCalledOnce();
  });

  it('does not render 推送至雲端 when onPushCloud is undefined', () => {
    const { container } = render(<ExportActions onExportCsv={vi.fn()} onPrint={vi.fn()} />);
    expect(container.textContent).not.toContain('推送至雲端');
  });

  it('renders 推送至雲端 when onPushCloud is provided', () => {
    const { getByText } = render(
      <ExportActions onExportCsv={vi.fn()} onPrint={vi.fn()} onPushCloud={vi.fn()} />
    );
    expect(getByText('推送至雲端')).toBeTruthy();
  });

  it('calls onPushCloud when 推送至雲端 clicked', () => {
    const onPushCloud = vi.fn();
    const { getByText } = render(
      <ExportActions onExportCsv={vi.fn()} onPrint={vi.fn()} onPushCloud={onPushCloud} />
    );
    fireEvent.click(getByText('推送至雲端'));
    expect(onPushCloud).toHaveBeenCalledOnce();
  });
});
