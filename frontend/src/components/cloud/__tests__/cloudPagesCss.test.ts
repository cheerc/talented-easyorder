// @ts-expect-error app tsconfig 只含 vite/client；本契約測試在 Vitest（Node）執行才需要檔案讀取
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上，Node 的 path 模組不在 app tsconfig 的型別來源內
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd(): string };

const CLOUD_DIR = resolve(process.cwd(), 'src/components/cloud');
const TOKENS = resolve(process.cwd(), 'src/styles/tokens.css');

const PAGE_CSS = [
  'CloudDayClosePage.css',
  'CloudDayVendorsPage.css',
  'CloudStudentsPage.css',
  'CloudReportPage.css',
  'CloudAccountHistoryPage.css',
  'CloudDayVendorForms.css',
  'LedgerUnclosedBanner.css',
  'CloudPendingRecoveryBoundary.css',
  'CloudLedgerAnomaliesPage.css',
  'CloudDiagnosticsPage.css',
];

const MENU_CSS = [
  { file: 'CloudStudentsPage.css', menu: '.cloud-students__more-menu', wrap: '.cloud-students__table-wrap' },
  { file: 'CloudAccountHistoryPage.css', menu: '.cloud-account-history__more-menu', wrap: '.cloud-account-history__table-wrap' },
];

function readCss(name: string): string {
  return readFileSync(resolve(CLOUD_DIR, name), 'utf8');
}

function stripPrintBlocks(css: string): string {
  return css.replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, '');
}

function hexCount(css: string): number {
  return (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
}

function tokenNames(): Set<string> {
  const tokens = readFileSync(TOKENS, 'utf8');
  return new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(match => match[1]));
}

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start) + 1);
}

const RETIRED_TOKENS = ['--surface-subtle', '--border', '--surface', '--text', '--color-danger', '--ok'];

describe('P4 其他頁 CSS 契約', () => {
  it.each(PAGE_CSS)('%s 不含列印以外的硬寫色碼', name => {
    expect(hexCount(stripPrintBlocks(readCss(name)))).toBe(0);
  });

  it.each(PAGE_CSS)('%s 不再引用已退役的舊變數', name => {
    const css = readCss(name);
    for (const retired of RETIRED_TOKENS) {
      expect(css).not.toContain(`var(${retired})`);
      expect(css).not.toContain(`var(${retired},`);
    }
  });

  it.each(PAGE_CSS)('%s 的每個 var() 都指向已定義的 token', name => {
    const css = readCss(name);
    const defined = tokenNames();
    const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(match => match[1]));
    const missing = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)]
      .map(match => match[1])
      .filter(token => !defined.has(token) && !local.has(token));
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('P4 列尾選單不撐開表格列', () => {
  it.each(MENU_CSS)('$file 的「⋯」選單是絕對定位浮層', ({ file, menu }) => {
    expect(ruleBody(readCss(file), menu)).toContain('position: absolute');
  });

  it.each(MENU_CSS)('$file 在選單展開時不裁切浮層', ({ file, wrap }) => {
    expect(ruleBody(readCss(file), `${wrap}:has(details[open])`)).toContain('overflow: visible');
  });
});
