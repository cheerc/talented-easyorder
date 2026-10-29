import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLOUD_DIR = resolve(__dirname, '../');

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
  const tokens = readFileSync(resolve(CLOUD_DIR, '../../styles/tokens.css'), 'utf8');
  return new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(match => match[1]));
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
