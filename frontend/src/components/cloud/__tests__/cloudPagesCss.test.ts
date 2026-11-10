// @ts-expect-error app tsconfig 只含 vite/client；本契約測試在 Vitest（Node）執行才需要檔案讀取
import { readdirSync, readFileSync } from 'node:fs';
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
  'DataUpdatedNotice.css',
];

const STYLES_DIR = resolve(process.cwd(), 'src/styles');
const UI_DIR = resolve(process.cwd(), 'src/components/ui');
const INDEX_CSS = resolve(process.cwd(), 'src/index.css');

// 硬寫 px 字級檢查清單（#648 P1）：新 ui 元件 CSS 與 token／等比放大 CSS。
// 每個雲端頁在改版 Phase 完成時，必須把自己的頁面 CSS 加進 FONT_SIZE_CHECKED_CLOUD_CSS；
// P8 結束時所有雲端頁 CSS 都要在清單內（見 docs/FRONTEND-UI-STYLE.md）。
const FONT_SIZE_CHECKED_UI_CSS = ['HelpTip.css', 'Callout.css', 'ActionCard.css', 'StatTile.css'];
const FONT_SIZE_CHECKED_CLOUD_CSS: string[] = ['CloudBackupPage.css', 'CloudOrdersPage.css', 'CloudReportPage.css', 'CloudDayClosePage.css', 'CloudDayVendorsPage.css', 'CloudDayVendorForms.css', 'CloudDiagnosticsPage.css', 'CloudStudentsPage.css', 'CloudAccountHistoryPage.css', 'CloudLedgerAnomaliesPage.css', 'CloudPendingRecoveryBoundary.css', 'LedgerUnclosedBanner.css', 'DataUpdatedNotice.css'];
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

  it('雲端目錄下每個頁面 CSS 都在 PAGE_CSS 與 FONT_SIZE_CHECKED_CLOUD_CSS（新頁面不能漏檢）', () => {
    const onDisk = (readdirSync(CLOUD_DIR) as string[]).filter(name => name.endsWith('.css')).sort();
    expect(PAGE_CSS.filter(name => !onDisk.includes(name))).toEqual([]);
    const unchecked = onDisk.filter(name => !FONT_SIZE_CHECKED_CLOUD_CSS.includes(name));
    expect(unchecked).toEqual([]);
    expect(onDisk.filter(name => !PAGE_CSS.includes(name))).toEqual([]);
  });

  it('檢查清單與新 ui 元件 CSS 同步（新增元件 CSS 不能漏檢）', () => {
    for (const name of FONT_SIZE_CHECKED_UI_CSS) {
      expect(() => readFileSync(resolve(UI_DIR, name), 'utf8')).not.toThrow();
    }
  });
});

describe('#652 雲端備份頁字級等比縮放 CSS 契約', () => {
  it('CloudBackupPage.css 覆寫 .bk-flow-sub、label、input、file-selector-button 與按鈕為既有 type tokens', () => {
    const css = readCss('CloudBackupPage.css');
    expect(css).toMatch(/\.cloud-backup\s+\.bk-flow-sub\s*\{[^}]*font-size:\s*var\(--t-sm\)/);
    expect(css).toMatch(/\.cloud-backup\s+\.bk-flow\s+label\s*\{[^}]*font-size:\s*var\(--t-sm\)/);
    expect(css).toMatch(/\.cloud-backup\s+\.bk-flow\s+input\[type="password"\],\s*\n?\.cloud-backup\s+\.bk-flow\s+input\[type="file"\]\s*\{[^}]*font-size:\s*var\(--t-sm\)/);
    expect(css).toMatch(/\.cloud-backup\s+\.bk-flow\s+input::file-selector-button\s*\{[^}]*font-size:\s*var\(--t-sm\)/);
    expect(css).toMatch(/\.cloud-backup\s+\.btn-confirm\s*\{[^}]*font-size:\s*var\(--t-md\)/);
  });
});

// #667：雲端外殼（topbar.css 與 App 內的原生控制項）字級在 cloud-scale.css 覆寫。
// topbar.css 與 prototype 共用，px 值保留給 prototype；雲端覆寫一律限定在 html[data-app-mode="cloud"] 之下，
// 並用 token／em／inherit，讓 1920 依 1440 等比放大（約 4/3）。
const CLOUD_SHELL_SELECTORS = [
  '.brand-name',
  '.brand-sub',
  '.brand-mark',
  '.tab',
  '.tab-key',
  '.status > button',
  '.cloud-subnav button',
  '.operator-menu__panel p',
  '.operator-menu__panel small',
  '.operator-menu__panel label',
  '.operator-menu__panel button',
  '.operator-menu__panel select',
];

describe('#667 雲端外殼字級用 token 等比放大', () => {
  const cloudScaleRules = () => {
    const css = readFileSync(resolve(STYLES_DIR, 'cloud-scale.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(match => ({
      selectors: match[1].split(',').map((selector: string) => selector.trim().replace(/\s+/g, ' ')),
      body: match[2],
    }));
  };

  it.each(CLOUD_SHELL_SELECTORS)('cloud-scale.css 有 html[data-app-mode="cloud"] %s 的字級規則，且不是 px', selector => {
    const full = `html[data-app-mode="cloud"] ${selector}`;
    const rule = cloudScaleRules().find(item => item.selectors.includes(full));
    expect(rule, `缺少 ${full}`).toBeDefined();
    const fontSize = rule!.body.match(/font-size:\s*([^;]+);?/)?.[1].trim() ?? '';
    expect(fontSize, `${full} 的 font-size`).toMatch(/^(var\(--t-[a-z0-9]+\)|\d*\.?\d+em)$/);
  });

  // 這兩個元素沒有自己的字級（label 繼承 body 的 --t-md、small 是瀏覽器的 smaller），本來就跟著 token 等比放大；
  // 覆寫成 --t-xs 會讓 1440 的 label 由 17px 縮成 13px。
  it.each(['.operator-menu__panel small', '.operator-menu__panel label'])('cloud-scale.css 不覆寫已繼承 token 的 %s', (selector: string) => {
    const full = `html[data-app-mode="cloud"] ${selector}`;
    expect(cloudScaleRules().filter(item => item.selectors.includes(full))).toEqual([]);
  });

  it('topbar.css 的 px 字級保留給 prototype（雲端覆寫不改 topbar.css）', () => {
    const topbar = readFileSync(resolve(STYLES_DIR, 'topbar.css'), 'utf8');
    expect(ruleBody(topbar, '.tab')).toContain('font-size: 14px');
    expect(ruleBody(topbar, '.brand-name')).toContain('font-size: 15px');
  });

  it('CloudOrdersPage.css 的原生 select 繼承容器字級（切換營業日），與其他雲端頁一致', () => {
    expect(readCss('CloudOrdersPage.css')).toMatch(/\.cloud-orders select\s*\{[^}]*font:\s*inherit/);
  });
});
