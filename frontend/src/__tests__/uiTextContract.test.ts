// @ts-expect-error app tsconfig 只含 vite/client；本契約測試在 Vitest（Node）執行才需要檔案讀取
import { readFileSync, readdirSync } from 'node:fs';
// @ts-expect-error 同上，Node 的 path 模組不在 app tsconfig 的型別來源內
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd(): string };

const SRC = resolve(process.cwd(), 'src');
const CLOUD = join(SRC, 'components/cloud');

type Entry = { name: string; isDirectory(): boolean };

function walk(dir: string): string[] {
  return (readdirSync(dir, { withFileTypes: true }) as Entry[]).flatMap(entry => {
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(join(dir, entry.name));
    return [join(dir, entry.name)];
  });
}

function productionSources(dir: string, pattern: RegExp): string[] {
  return walk(dir).filter(file => pattern.test(file) && !/\.(test|spec)\./.test(file));
}

/** 只留下會顯示給使用者或朗讀的程式碼列；整行註解不算 UI 文字。 */
function uiLines(file: string): Array<{ line: number; text: string }> {
  return (readFileSync(file, 'utf8') as string).split('\n')
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

function where(file: string, line: number): string {
  return `${relative(SRC, file)}:${line}`;
}

describe('P5 UI 文字：雲端前綴、F 鍵誤導與工程用語', () => {
  const cloudTsx = productionSources(CLOUD, /\.tsx$/);

  it('雲端頁面不再用沒有綁鍵的 F 鍵 eyebrow，也不顯示「雲端資料 · 線上操作」', () => {
    const offenders: string[] = [];
    for (const file of cloudTsx) {
      for (const { line, text } of uiLines(file)) {
        if (/eyebrow[^>]*>/.test(text) && /(F[1-6]\s*·|雲端資料 · 線上操作|完整伺服器快照|帳戶完整歷史前綴)/.test(text)) {
          offenders.push(where(file, line));
        }
        if (/雲端資料 · 線上操作/.test(text)) offenders.push(where(file, line));
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('可見頁面標題不帶「雲端」前綴', () => {
    const offenders: string[] = [];
    for (const file of cloudTsx) {
      for (const { line, text } of uiLines(file)) {
        if (/<h[1-3][^>]*>\s*雲端/.test(text)) offenders.push(where(file, line));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('櫃台頁與報表頁標題為「櫃台點餐」「報表」「查帳與歷史更正」', () => {
    const read = (name: string) => readFileSync(join(CLOUD, name), 'utf8') as string;
    expect(read('CloudOrdersPage.tsx')).toContain('<h2>櫃台點餐</h2>');
    expect(read('CloudReportPage.tsx')).toContain('<h2>報表</h2>');
    expect(read('CloudAccountHistoryPage.tsx')).toContain('<h2>查帳與歷史更正</h2>');
  });

  it('櫃台頁名稱不使用「前綴」「快照原則」等工程用語', () => {
    const offenders: string[] = [];
    for (const file of cloudTsx) {
      for (const { line, text } of uiLines(file)) {
        if (/(前綴|快照原則)/.test(text)) offenders.push(where(file, line));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('畫面文字中的 F 鍵都有實際綁定：只有 F1–F5；F6 僅限練習模式', () => {
    const offenders: string[] = [];
    const uiFiles = productionSources(join(SRC, 'components'), /\.tsx$/).concat(join(SRC, 'App.tsx'));
    for (const file of uiFiles) {
      const isCloud = file.startsWith(CLOUD);
      for (const { line, text } of uiLines(file)) {
        for (const match of text.matchAll(/\bF([1-9])\b/g)) {
          const n = Number(match[1]);
          if (n > 6 || (n === 6 && (isCloud || !/pos\/TopBar\.tsx$/.test(file)))) {
            offenders.push(`${where(file, line)} F${n}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('P5 emoji 改用 SVG icon', () => {
  const ALLOWED = new Set(['✓', '✕']);

  it('畫面程式碼沒有 emoji／彩色圖示字元（✓ ✕ 文字符號除外）', () => {
    const offenders: string[] = [];
    for (const file of productionSources(SRC, /\.tsx?$/)) {
      for (const { line, text } of uiLines(file)) {
        for (const char of text.match(/\p{Extended_Pictographic}/gu) ?? []) {
          if (!ALLOWED.has(char)) offenders.push(`${where(file, line)} ${char}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('P5 焦點外框', () => {
  const cssFiles = productionSources(SRC, /\.css$/);

  it('沒有元件 CSS 宣告 outline: none／0 而缺少替代焦點樣式', () => {
    // 輸入框被外層容器包住時，由容器的 :focus-within 負責焦點外框／陰影。
    const wrappedInputs = new Set(['.num-input', '.search-input', '.pay-input-main', '.cloud-orders__search-input']);
    const offenders: string[] = [];
    for (const file of cssFiles) {
      const css = readFileSync(file, 'utf8') as string;
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim().split(/\s*,\s*/).pop() ?? '';
        if (!/outline:\s*(none|0)\b/.test(rule[2])) continue;
        const base = selector.replace(/:focus.*$/, '');
        if (wrappedInputs.has(base)) continue;
        offenders.push(`${relative(SRC, file)} ${selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('包住輸入框的容器在 :focus-within 時有可見的外框或陰影', () => {
    const wrappers: Array<{ file: string; selector: string }> = [
      { file: 'components/ui/NumberField.css', selector: '.num-input-wrap:focus-within' },
      { file: 'styles/pos.css', selector: '.search:focus-within' },
      { file: 'styles/pos.css', selector: '.pay-input-container:focus-within' },
      { file: 'components/cloud/CloudOrdersPage.css', selector: '.cloud-orders__search-field:focus-within' },
    ];
    for (const { file, selector } of wrappers) {
      const css = readFileSync(join(SRC, file), 'utf8') as string;
      const rule = css.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
      expect(rule, `${file} ${selector}`).not.toBeNull();
      expect(rule?.[1], `${file} ${selector}`).toMatch(/(outline:\s*2px|box-shadow)/);
    }
  });

  it('TopBar 日期輸入不再用 inline style 關掉 outline', () => {
    const source = readFileSync(join(SRC, 'components/pos/TopBar.tsx'), 'utf8') as string;
    expect(source).not.toMatch(/outline:\s*'none'/);
  });
});
