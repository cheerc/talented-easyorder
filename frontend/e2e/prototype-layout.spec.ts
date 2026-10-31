// P6：prototype 窄寬版面回歸（Issue #565）。使用 prototype 模式的合成範例資料；不需要 Emulator。
import { test, expect } from './prototype-fixtures';

const WIDTHS = [1024, 689] as const;

/** 以文字節點的實際排版矩形數出行數：不同 top 代表換行。 */
const LINE_COUNT_SCRIPT = `(node) => {
  const range = document.createRange();
  range.selectNodeContents(node);
  const tops = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 0).map(rect => Math.round(rect.top)));
  return tops.size;
}`;

for (const width of WIDTHS) {
  test.describe(`prototype 版面 ${width}px`, () => {
    test.use({ viewport: { width, height: 768 } });

    test('五個主分頁完整可見，頁面沒有橫向捲動', async ({ prototypePage: page }) => {
      const tabs = page.locator('.app-shell .tabs .tab');
      await expect(tabs).toHaveCount(5);
      const boxes = await tabs.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        const text = node.textContent ?? '';
        return { text, left: rect.left, right: rect.right, width: rect.width, scroll: (node as HTMLElement).scrollWidth };
      }));
      for (const box of boxes) {
        // 分頁不被壓縮：內容寬度不超出元素寬度。
        expect(box.scroll, `${box.text} 被壓縮`).toBeLessThanOrEqual(Math.ceil(box.width));
        // 這個寬度下五個分頁都在視窗內，不靠捲動才看得到。
        expect(box.left, `${box.text} 左側`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${box.text} 右側`).toBeLessThanOrEqual(width);
      }
      // 分頁列本身不需要捲動就能看到全部分頁（不被外層容器裁掉）。
      const strip = await page.locator('.app-shell .tabs').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
      expect(strip.scroll).toBeLessThanOrEqual(strip.client);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('今日設定的學員操作鈕不直排換行', async ({ prototypePage: page }) => {
      await page.keyboard.press('F3');
      const buttons = page.locator('.adm-stu-actions button');
      await expect(buttons.first()).toBeVisible();
      const lines = await buttons.evaluateAll((nodes, script) => {
        const count = new Function(`return ${script}`)() as (node: Element) => number;
        return nodes.slice(0, 8).map(node => ({ text: node.textContent ?? '', lines: count(node) }));
      }, LINE_COUNT_SCRIPT);
      for (const item of lines) expect(item.lines, `${item.text} 按鈕被換成多行`).toBe(1);
    });

    test('供應商電話不斷行', async ({ prototypePage: page }) => {
      await page.keyboard.press('F4');
      const phones = page.locator('.vendor-phone');
      await expect(phones.first()).toBeVisible();
      const items = await phones.evaluateAll((nodes, script) => {
        const count = new Function(`return ${script}`)() as (node: Element) => number;
        return nodes.map(node => ({ text: node.textContent?.trim() ?? '', lines: count(node) }));
      }, LINE_COUNT_SCRIPT);
      for (const item of items.filter(entry => entry.text !== '-')) expect(item.lines, `${item.text} 電話被斷行`).toBe(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe('prototype 純圖示按鈕', () => {
  test('各分頁的純圖示按鈕都有 aria-label（v3 §3.2）', async ({ prototypePage: page }) => {
    for (const key of ['F1', 'F2', 'F3', 'F4', 'F5']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(300);
      const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
        .filter(button => !(button.textContent ?? '').replace(/[\s​]/g, '') && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby'))
        .map(button => button.className || button.outerHTML.slice(0, 80)));
      expect(unnamed, `${key} 有沒有名稱的純圖示按鈕`).toEqual([]);
    }
  });
});
