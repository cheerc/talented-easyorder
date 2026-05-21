import React, { useEffect, useState } from 'react';
import { NumericInput } from '../ui/NumericInput';
import type { ExpenseDirection } from '../../domain/posFlow';

const EXPENSE_QUICK_OPTIONS = ['付便當錢', '其他原因'] as const;

interface ExpensePanelProps {
  kind: 'expense_input' | 'expense_direction' | 'expense_reason' | 'expense_other_note';
  amountText: string;
  amount: number;
  onAmountChange: (text: string) => void;
  onAmountConfirm: (amount: number) => void;
  onDirectionSelect: (direction: ExpenseDirection) => void;
  onReasonSelect: (reason: '付便當錢' | '支出其他' | '收入其他') => void;
  onNoteChange: (note: string) => void;
  onNoteConfirm: (note: string) => void;
  onCancel: () => void;
}

export const ExpensePanel = React.memo(function ExpensePanel(props: ExpensePanelProps) {
  const { kind, amountText, amount, onAmountChange, onAmountConfirm, onDirectionSelect, onReasonSelect, onNoteChange, onNoteConfirm, onCancel } = props;

  const [selIdx, setSelIdx] = useState(0);

  useEffect(() => {
    setSelIdx(0);
  }, [kind]);

  useEffect(() => {
    if (kind !== 'expense_direction' && kind !== 'expense_reason') return;

    const optionCount = kind === 'expense_direction' ? 2 : EXPENSE_QUICK_OPTIONS.length;

    const onKey = (e: KeyboardEvent) => {
      if ((e as any).__handledByExpensePanel) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelIdx(idx => Math.max(0, idx - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelIdx(idx => Math.min(optionCount - 1, idx + 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        (e as any).__handledByExpensePanel = true;
        if (kind === 'expense_direction') {
          onDirectionSelect(selIdx === 0 ? 'expense' : 'income');
        } else {
          const opt = EXPENSE_QUICK_OPTIONS[selIdx];
          onReasonSelect(opt === '其他原因' ? '支出其他' : '付便當錢');
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        (e as any).__handledByExpensePanel = true;
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, onDirectionSelect, onReasonSelect, onCancel, selIdx]);

  return (
    <div className="card customer" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="pay-title">新增 收入/支出</div>

      {kind === 'expense_input' && (
        <>
          <div className="pay-input-container">
            <span className="pay-input-prefix">$</span>
            <NumericInput
              className="pay-input-main"
              aria-label="金額"
              value={amountText}
              onChange={onAmountChange}
              placeholder="輸入金額"
              autoFocus
              onKeyDown={e => {
                if ((e.nativeEvent as any).__handledByExpensePanel) return;

                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.nativeEvent.stopImmediatePropagation();
                  (e.nativeEvent as any).__handledByExpensePanel = true;
                  const n = Number(amountText);
                  if (Number.isFinite(n) && n > 0) {
                    onAmountConfirm(n);
                  }
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  (e.nativeEvent as any).__handledByExpensePanel = true;
                  onCancel();
                }
              }}
            />
            <span className="pay-input-suffix">元</span>
          </div>
        </>
      )}

      {kind === 'expense_direction' && (
        <>
          <div className="dup-warn" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div className="dup-warn-h">金額 ${Math.abs(amount)} — 選擇類型</div>
            <div className="dup-warn-btns" style={{ marginTop: '12px', gap: '16px' }}>
              <button className="btn-confirm" style={selIdx === 0 ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined} onClick={() => onDirectionSelect('expense')}>
                支出
              </button>
              <button className="btn-confirm" style={selIdx === 1 ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined} onClick={() => onDirectionSelect('income')}>
                收入
              </button>
            </div>
          </div>
          <div className="dim" style={{ textAlign: 'center', fontSize: '12px' }}>
            <span className="kbd">←</span><span className="kbd">→</span> 選擇 · <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 取消
          </div>
        </>
      )}

      {kind === 'expense_reason' && (
        <>
          <div className="dup-warn" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div className="dup-warn-h">{amount ? `$${Math.abs(amount)} — 選擇原因` : '選擇原因'}</div>
            <div className="dup-warn-btns" style={{ marginTop: '12px', gap: '16px' }}>
              {EXPENSE_QUICK_OPTIONS.map((opt, i) => (
                <button key={opt} className="btn-confirm" style={selIdx === i ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined} onClick={() => onReasonSelect(opt === '其他原因' ? '支出其他' : '付便當錢')}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="dim" style={{ textAlign: 'center', fontSize: '12px' }}>
            <span className="kbd">←</span><span className="kbd">→</span> 選擇 · <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 取消
          </div>
        </>
      )}

      {kind === 'expense_other_note' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
          <span className="dim" style={{ fontSize: '12px' }}>備註（必填）</span>
          <input
            className="adm-input"
            aria-label="備註"
            placeholder="請輸入備註"
            autoFocus
            onKeyDown={e => {
              if ((e.nativeEvent as any).__handledByExpensePanel) return;

              if (e.key === 'Enter') {
                e.preventDefault();
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) {
                  e.nativeEvent.stopImmediatePropagation();
                  (e.nativeEvent as any).__handledByExpensePanel = true;
                  onNoteConfirm(v);
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                (e.nativeEvent as any).__handledByExpensePanel = true;
                onCancel();
              }
            }}
            onChange={e => onNoteChange(e.target.value)}
          />
          <div className="dim" style={{ fontSize: '12px', marginTop: '4px' }}>
            <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 取消
          </div>
        </div>
      )}
    </div>
  );
});
