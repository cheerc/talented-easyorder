// @ts-expect-error app tsconfig 只含 vite/client；本契約測試在 Vitest（Node）執行才需要檔案讀取
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上，Node 的 path 模組不在 app tsconfig 的型別來源內
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd(): string };

const CLOUD_DIR = resolve(process.cwd(), 'src/components/cloud');
const TOKENS = resolve(process.cwd(), 'src/styles/tokens.css');

const PAGE_CSS = [
  'CloudOrdersPage.css',
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
  'CloudBackupPage.css',
];

const STYLES_DIR = resolve(process.cwd(), 'src/styles');
const UI_DIR = resolve(process.cwd(), 'src/components/ui');
const INDEX_CSS = resolve(process.cwd(), 'src/index.css');

// 硬寫 px 字級檢查清單（#648 P1）：新 ui 元件 CSS 與 token／等比放大 CSS。
// 每個雲端頁在改版 Phase 完成時，必須把自己的頁面 CSS 加進 FONT_SIZE_CHECKED_CLOUD_CSS；
// P8 結束時所有雲端頁 CSS 都要在清單內（見 docs/FRONTEND-UI-STYLE.md）。
const FONT_SIZE_CHECKED_UI_CSS = ['HelpTip.css', 'Callout.css', 'ActionCard.css', 'StatTile.css'];
const FONT_SIZE_CHECKED_CLOUD_CSS: string[] = ['CloudBackupPage.css', 'CloudOrdersPage.css', 'CloudReportPage.css', 'CloudDayClosePage.css'];
const FONT_SIZE_CHECKED_STYLES_CSS = ['data-table.css'];

const TYPE_TOKENS = ['--t-xs', '--t-sm', '--t-md', '--t-lg', '--t-xl', '--t-2xl', '--t-num'];
const SPACE_TOKENS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7'];
const FONT_TOKENS = ['--font-sans', '--font-mono'];

function themeBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('\n}', start));
}

function declaredTokens(block: string): string[] {
  return [...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map(m => m[1]).sort();
}

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

describe('#648 P1 token 與主題契約', () => {
  it('tokens.css 的 :root 定義字級、間距、字型全部 token', () => {
    const root = themeBlock(readFileSync(TOKENS, 'utf8'), ':root');
    const names = declaredTokens(root);
    for (const token of [...TYPE_TOKENS, ...SPACE_TOKENS, ...FONT_TOKENS]) {
      expect(names).toContain(token);
    }
  });

  it('字級與間距 token 用 rem（隨 html 等比放大）', () => {
    const root = themeBlock(readFileSync(TOKENS, 'utf8'), ':root');
    for (const token of [...TYPE_TOKENS, ...SPACE_TOKENS]) {
      expect(root).toMatch(new RegExp(`${token}:\\s*[0-9.]+rem;`));
    }
  });

  it('字型 token 不依賴網路字型（不新增 @font-face 或 @import url）', () => {
    const all = [TOKENS, INDEX_CSS].map(f => readFileSync(f, 'utf8')).join('\n');
    expect(all).not.toContain('@font-face');
    expect(all).not.toMatch(/@import\s+url\(/);
  });

  it('三主題（:root、dark、warm）定義相同的顏色 token 集合', () => {
    const css = readFileSync(TOKENS, 'utf8');
    const color = (names: string[]) => names.filter(n => !TYPE_TOKENS.includes(n) && !SPACE_TOKENS.includes(n) && !FONT_TOKENS.includes(n) && !['--r', '--r-lg', '--fs', '--shadow'].includes(n));
    const light = color(declaredTokens(themeBlock(css, ':root')));
    // 淺色獨有（--pos、--danger* 等）以外，dark／warm 必須涵蓋淺色的顏色 token
    for (const theme of ['[data-theme="dark"]', '[data-theme="warm"]']) {
      const names = color(declaredTokens(themeBlock(css, theme)));
      const missing = light.filter(n => !names.includes(n) && n !== '--pos');
      expect({ theme, missing }).toEqual({ theme, missing: [] });
    }
  });
});

describe('#648 P1 雲端等比放大只限雲端模式', () => {
  const cloudScale = () => readFileSync(resolve(STYLES_DIR, 'cloud-scale.css'), 'utf8');

  it('cloud-scale.css 以 html[data-app-mode="cloud"] 設 clamp 根字級與字型', () => {
    const css = cloudScale();
    expect(css).toContain('html[data-app-mode="cloud"]');
    expect(css).toContain('clamp(14px, calc(100vw / 90), 21.333px)');
    expect(css).toContain('var(--font-sans)');
  });

  it('cloud-scale.css 的每個選擇器都限定在 data-app-mode="cloud" 之下', () => {
    const css = cloudScale().replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel).toContain('[data-app-mode="cloud"]');
  });

  it('雲端 body 字級是 var(--t-md)（改版前預設 scale=large 為 17px；覆蓋 body[data-fs] 的 --fs）', () => {
    const css = cloudScale().replace(/\/\*[\s\S]*?\*\//g, '');
    const body = css.match(/html\[data-app-mode="cloud"\] body\s*\{([^}]*)\}/);
    expect(body).not.toBeNull();
    expect(body![1]).toMatch(/font-size:\s*var\(--t-md\)/);
  });

  it('index.css 引入 cloud-scale.css', () => {
    expect(readFileSync(INDEX_CSS, 'utf8')).toContain("@import './styles/cloud-scale.css'");
  });
});

describe('#648 P1 表格表頭垂直置中', () => {
  it('data-table.css 的表頭 vertical-align: middle', () => {
    expect(ruleBody(readFileSync(resolve(STYLES_DIR, 'data-table.css'), 'utf8'), '.dt thead th')).toContain('vertical-align: middle');
  });

  it.each([...PAGE_CSS])('%s 不對 th 宣告 vertical-align: top', name => {
    const css = stripPrintBlocks(readCss(name)).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = rule[1].split(',').map(s => s.trim());
      if (selectors.some(s => /(^|[\s>+~])th\b/.test(s)) && /vertical-align:\s*top/.test(rule[2])) {
        throw new Error(`${name}: ${rule[1].trim()} 對 th 宣告 vertical-align: top`);
      }
    }
  });
});

describe('#648 P1 字級守門（硬寫 px 字級）', () => {
  const hardPx = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/font-size:\s*\d+(\.\d+)?px/g)].map(m => m[0]);

  it.each(FONT_SIZE_CHECKED_UI_CSS)('ui/%s 不硬寫 px 字級', name => {
    expect(hardPx(readFileSync(resolve(UI_DIR, name), 'utf8'))).toEqual([]);
  });

  it.each(FONT_SIZE_CHECKED_STYLES_CSS)('styles/%s 不硬寫 px 字級', name => {
    expect(hardPx(readFileSync(resolve(STYLES_DIR, name), 'utf8'))).toEqual([]);
  });

  it.each(FONT_SIZE_CHECKED_CLOUD_CSS)('cloud/%s 不硬寫 px 字級', name => {
    expect(hardPx(readCss(name))).toEqual([]);
  });

  it('檢查清單與新 ui 元件 CSS 同步（新增元件 CSS 不能漏檢）', () => {
    for (const name of FONT_SIZE_CHECKED_UI_CSS) {
      expect(() => readFileSync(resolve(UI_DIR, name), 'utf8')).not.toThrow();
    }
  });
});
