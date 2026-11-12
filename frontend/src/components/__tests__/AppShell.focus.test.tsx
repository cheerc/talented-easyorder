// @ts-expect-error app tsconfig 只含 vite/client；本契約測試在 Vitest（Node）執行才需要檔案讀取
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上，Node 的 path 模組不在 app tsconfig 的型別來源內
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppShell } from '../AppShell';

declare const process: { cwd(): string };

describe('AppShell tab focus (#705)', () => {
  it('moves the focus to the new active tab only when it was inside the tabs', () => {
    const view = render(<AppShell brand={null} active="pos" select={() => undefined} status={<button type="button">外部</button>} />);
    screen.getByRole('button', { name: '櫃台' }).focus();
    view.rerender(<AppShell brand={null} active="report" select={() => undefined} status={<button type="button">外部</button>} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '今日帳' }));

    screen.getByRole('button', { name: '外部' }).focus();
    view.rerender(<AppShell brand={null} active="admin" select={() => undefined} status={<button type="button">外部</button>} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '外部' }));
  });

  it('does not take the focus when nothing in the tabs is active', () => {
    const view = render(<AppShell brand={null} active="pos" select={() => undefined} />);
    screen.getByRole('button', { name: '櫃台' }).focus();
    view.rerender(<AppShell brand={null} active="" select={() => undefined} />);
    expect(screen.getByRole('button', { name: '櫃台' })).toHaveFocus();
  });
});

describe('.tab focus ring is drawn inside the tab (#705)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/topbar.css'), 'utf8') as string;

  it('has its own focus-visible rule with a negative outline-offset, because .tabs clips anything outside the buttons', () => {
    const rule = /\.tab:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/outline:\s*2px solid var\(--focus-ring\)/);
    expect(rule![1]).toMatch(/outline-offset:\s*-\d+px/);
  });

  it('keeps the ring visible on the dark active tab', () => {
    const rule = /\.tab-on:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/box-shadow:\s*inset/);
  });
});
