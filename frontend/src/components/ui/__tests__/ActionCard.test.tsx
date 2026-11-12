import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
// @ts-expect-error app tsconfig 只含 vite/client；本契約測試在 Vitest（Node）執行才需要檔案讀取
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上，Node 的 path 模組不在 app tsconfig 的型別來源內
import { resolve } from 'node:path';

declare const process: { cwd(): string };
import { ActionCard } from '../ActionCard';

describe('ActionCard', () => {
  it('整張是單一 button，accessible name 為完整句子', () => {
    render(<ActionCard title="今天還沒建立營業日" description="到菜單與開帳設定今天的菜單" actionLabel="前往菜單與開帳" kbd="F3" onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: '今天還沒建立營業日，到菜單與開帳設定今天的菜單，前往菜單與開帳' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('顯示 Kbd 提示，且不污染 accessible name', () => {
    render(<ActionCard title="T" actionLabel="去" kbd="F3" onClick={() => {}} />);
    expect(screen.getByText('F3').tagName).toBe('KBD');
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('T，去');
  });

  it('點擊觸發 onClick；disabled 時不觸發', () => {
    const onClick = vi.fn();
    const { rerender } = render(<ActionCard title="T" actionLabel="去" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<ActionCard title="T" actionLabel="去" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('layout 預設為 hero（置中直排）；inline 為精簡橫排；accessible name 不受 layout 影響', () => {
    const { rerender } = render(<ActionCard title="T" description="D" actionLabel="去" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveClass('action-card-ui', 'action-card-ui--hero');
    expect(screen.getByRole('button')).not.toHaveClass('action-card-ui--inline');
    rerender(<ActionCard title="T" description="D" actionLabel="去" layout="inline" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveClass('action-card-ui', 'action-card-ui--inline');
    expect(screen.getByRole('button')).not.toHaveClass('action-card-ui--hero');
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('T，D，去');
  });
});

/** 取出單一規則的宣告區塊（selector 需完全相符）。 */
function rule(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').map(x => x.trim()).includes(selector)) return m[2];
  }
  throw new Error(`找不到規則 ${selector}`);
}

describe('ActionCard.css 版面契約（#708，依核准 F1 mockup）', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/components/ui/ActionCard.css'), 'utf8');

  it('hero：置中直排、2px 虛線強調色外框、強調色淡底', () => {
    const body = rule(css, '.action-card-ui--hero');
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/text-align:\s*center/);
    expect(body).toMatch(/border:\s*2px dashed var\(--accent\)/);
    expect(body).toMatch(/background:\s*var\(--accent-soft\)/);
  });

  it('hero：標題 --t-2xl、說明 --t-lg、膠囊 --accent-ink 底 --t-lg 字', () => {
    expect(rule(css, '.action-card-ui--hero .action-card-ui__title')).toMatch(/font-size:\s*var\(--t-2xl\)/);
    expect(rule(css, '.action-card-ui--hero .action-card-ui__desc')).toMatch(/font-size:\s*var\(--t-lg\)/);
    const pill = rule(css, '.action-card-ui--hero .action-card-ui__pill');
    expect(pill).toMatch(/background:\s*var\(--accent-ink\)/);
    expect(pill).toMatch(/font-size:\s*var\(--t-lg\)/);
  });

  it('hero：圖示 3rem；hover 以 color-mix 加深；reduced-motion 取消位移', () => {
    expect(rule(css, '.action-card-ui--hero .action-card-ui__icon svg')).toMatch(/width:\s*3rem/);
    expect(css).toMatch(/\.action-card-ui--hero:hover:not\(:disabled\)[^{]*\{[^}]*color-mix\(/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('inline：文字區不撐滿（flex: none），膠囊緊接在說明右側', () => {
    expect(rule(css, '.action-card-ui--inline .action-card-ui__text')).toMatch(/flex:\s*none/);
  });

  it('hero 膠囊字色用 var(--bg)（tokens.css 沒有 --on-accent；--bg 三主題皆有定義）', () => {
    const pill = rule(css, '.action-card-ui--hero .action-card-ui__pill');
    expect(pill).toMatch(/(^|[;\s])color:\s*var\(--bg\)/);
    expect(css).not.toContain('--on-accent');
  });
});
