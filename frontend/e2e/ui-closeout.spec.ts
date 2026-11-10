// #648/#650/#652：真 App + demo-easyorder Emulator；只使用合成資料，不提交截圖。
import { test, expect } from './fixtures';
import { accountCheck } from './helpers/navigation';
import { seedAccessLease } from './helpers/seed';
import { JOURNAL_NAMESPACE, clearLeftoverBusinessState, seedAdjacentCashGap, seedOpenDayWithMenu, seedPendingCommand, seedUnopenedPastDay, type ScenarioHandle } from './helpers/scenarios';
import type { Locator, Page } from '@playwright/test';

// 對實際渲染文字量測：Canvas 將 Chromium 解析的 oklch 轉 sRGB，逐層合成透明背景。
async function contrast(locator: Locator, property: 'color' | 'outlineColor' = 'color') {
  return locator.evaluate((node, property) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].map((n, i) => i === 3 ? n / 255 : n);
    };
    const over = (fg: number[], bg: number[]) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
    const chain: Element[] = [];
    for (let n: Element | null = node; n; n = n.parentElement) chain.unshift(n);
    let bg = [255, 255, 255, 1];
    // outline-offset: 2px 的環位於按鈕外側，對比背景是祖先，不是 hover 的按鈕底色。
    for (const n of chain) {
      if (property === 'outlineColor' && n === node) continue;
      bg = over(rgba(getComputedStyle(n).backgroundColor), bg);
    }
    const fg = over(rgba(getComputedStyle(node)[property]), bg);
    const lum = (rgb: number[]) => rgb.slice(0, 3).map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [.2126, .7152, .0722][i], 0);
    const a = lum(fg), b = lum(bg);
    return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), font: getComputedStyle(node).fontSize };
  }, property);
}

async function help(page: Page, scope: Locator, name: string) {
  const button = scope.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(23.95);
  expect(box!.height).toBeGreaterThanOrEqual(23.95);
  await button.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  expect((await contrast(tooltip)).ratio).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 0);
  // 真實 Tab，不用 focus() 偽造鍵盤焦點。
  let reached = false;
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press('Tab');
    if (await button.evaluate(n => n === document.activeElement)) { reached = true; break; }
  }
  expect(reached).toBe(true);
  await expect(tooltip).toBeVisible();
  const ring = await button.evaluate(n => ({ width: getComputedStyle(n).outlineWidth, style: getComputedStyle(n).outlineStyle }));
  expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
  expect(ring.style).toBe('solid');
  const ringContrast = await contrast(button, 'outlineColor');
  expect(ringContrast.ratio).toBeGreaterThanOrEqual(3);
  console.log('UI-HELP', name, JSON.stringify({ width: box!.width, height: box!.height, ringContrast: ringContrast.ratio }));
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await button.click();
  await expect(tooltip).toBeVisible();
  const bounds = await tooltip.boundingBox();
  const triggerBounds = await button.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(triggerBounds!.y + triggerBounds!.height);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  return box;
}

async function controls(scope: Locator) {
  for (const button of await scope.locator('button:visible').all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(23.95);
    expect(box!.width).toBeGreaterThanOrEqual(23.95);
    expect((await button.getAttribute('aria-label')) || (await button.innerText())).not.toBe('');
  }
  const overflow = await scope.evaluate(n => n.scrollWidth - n.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const theme of ['light', 'dark', 'warm']) {
  for (const width of [1440, 1920]) {
    test.describe(`UI 收尾 ${theme} ${width}`, () => {
      test.use({ viewport: { width, height: width === 1440 ? 900 : 1080 } });
      // 情境 fixture（相鄰營業日帳差）由 helpers/scenarios.ts 建立與清理；afterEach 一定會清。
      let scenario: ScenarioHandle | undefined;
      test.beforeEach(async () => {
        await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
      });
      test.afterEach(async () => {
        await scenario?.cleanup();
        scenario = undefined;
        await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
      });

      test('備份實際字級、說明與有內容的帳務異常', async ({ googleSession }) => {
        const { page } = googleSession;
        const gap = await seedAdjacentCashGap();
        scenario = gap;
        await page.getByRole('button', { name: '取得系統使用權' }).click();
        await expect(page.locator('.operator-strip')).toBeVisible();
        // App 的主題控制可能覆寫初始屬性；量測前明確設定本輪主題。
        await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); document.body.setAttribute('data-theme', t); }, theme);
        await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '今日設定', exact: true }).click();
        await page.getByRole('navigation', { name: '今日設定' }).getByRole('button', { name: '資料備份', exact: true }).click();
        const backup = page.locator('.cloud-backup');
        await expect(backup.getByRole('heading', { name: '資料備份' })).toBeVisible();
        const scale = width / 1440;
        const fonts: Record<string, string> = {};
        for (const selector of ['.bk-flow-sub', '.bk-flow label', 'input[type="password"]', 'input[type="file"]', '.btn-confirm']) {
          const font = await backup.locator(selector).first().evaluate(n => getComputedStyle(n).fontSize);
          fonts[selector] = font;
          expect(parseFloat(font)).toBeCloseTo((selector === '.btn-confirm' ? 17 : 15) * scale, 1);
        }
        const fileFont = await backup.locator('input[type="file"]').first().evaluate(n => getComputedStyle(n, '::file-selector-button').fontSize);
        expect(parseFloat(fileFont)).toBeCloseTo(15 * scale, 1);
        await controls(backup);
        await help(page, backup, '備份說明');
        const warning = backup.getByText('第二份副本需由操作者複製至公司受控電腦或加密離線媒體並確認。');
        await expect(warning).toBeVisible();
        const backupContrast = await contrast(warning);
        expect(backupContrast.ratio).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({ path: `/tmp/ui-closeout-${theme}-${width}-backup.png`, fullPage: true });
        await accountCheck(page);
        const ledger = page.locator('.cloud-ledger-anomalies');
        const anomalyItem = ledger.locator('li.cloud-ledger-anomalies__item').filter({ has: page.getByTestId(`post-close-shortcut-${gap.newerDay}`) });
        await expect(anomalyItem.getByTestId(`post-close-shortcut-${gap.newerDay}`)).toBeVisible();
        await expect(anomalyItem.getByText('補記不會修改原關帳實點，也不會自動更正其他交易。')).toBeVisible();
        await controls(ledger);
        await help(page, ledger, '異常判定與處理原則');
        await help(page, anomalyItem, '差額處理說明');
        const ratios: number[] = [];
        for (const item of await ledger.locator('h1, h3, p, .cloud-ledger-anomalies__status, .cloud-ledger-anomalies__callout').all()) {
          const result = await contrast(item);
          console.log('UI-CONTRAST', theme, width, await item.getAttribute('class'), result);
          ratios.push(result.ratio);
        }
        expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
        console.log('UI-MATRIX', JSON.stringify({ theme, width, fonts, fileFont, backupContrast, ledgerMinContrast: Math.min(...ratios) }));
        await page.screenshot({ path: `/tmp/ui-closeout-${theme}-${width}-ledger.png`, fullPage: true });
      });

      test('待核對真頁面保留編號與重複收款警示', async ({ googleSession }) => {
        const { page, uid } = googleSession;
        const pendingScenario = await seedPendingCommand(page, uid);
        scenario = pendingScenario;
        const commandId = pendingScenario.commandId;
        await page.getByRole('button', { name: '取得系統使用權' }).click();
        const pending = page.locator('.cloud-pending-recovery');
        await expect(pending.getByText(commandId)).toBeVisible();
        await expect(pending.getByText('伺服器目前未查到的編號仍可能已入帳；不可重新收款或重登。')).toBeVisible();
        await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); document.body.setAttribute('data-theme', t); }, theme);
        await help(page, pending, '待核對容量說明');
        await controls(pending);
        const ratios: number[] = [];
        for (const text of await pending.locator('h2, p, label, code').all()) ratios.push((await contrast(text)).ratio);
        expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
        expect(await page.evaluate(key => localStorage.getItem(key), `${JOURNAL_NAMESPACE}:${commandId}`)).not.toBeNull();
        await expect(page.getByRole('button', { name: '櫃台', exact: true })).toHaveCount(0);
        console.log('UI-PENDING', JSON.stringify({ theme, width, minContrast: Math.min(...ratios) }));
        await page.screenshot({ path: `/tmp/ui-closeout-${theme}-${width}-pending.png`, fullPage: true });
      });

      // #666：靠近視窗左右邊緣的說明氣泡水平留在視窗內，且不遮住觸發按鈕。
      async function expectTipInsideViewport(page: Page, button: Locator) {
        await expect(button).toBeVisible();
        await button.click();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toBeVisible();
        const tip = await tooltip.boundingBox();
        const trigger = await button.boundingBox();
        expect(tip!.x, `${await button.getAttribute('aria-label')} 氣泡左緣`).toBeGreaterThanOrEqual(0);
        expect(tip!.x + tip!.width, `${await button.getAttribute('aria-label')} 氣泡右緣`).toBeLessThanOrEqual(page.viewportSize()!.width);
        expect(tip!.y).toBeGreaterThanOrEqual(trigger!.y + trigger!.height);
        await page.keyboard.press('Escape');
        await expect(tooltip).toHaveCount(0);
      }

      test('靠邊說明氣泡留在視窗內：櫃台收支說明', async ({ googleSession }) => {
        const { page } = googleSession;
        await clearLeftoverBusinessState();
        const open = await seedOpenDayWithMenu();
        scenario = open;
        await page.getByRole('button', { name: '取得系統使用權' }).click();
        await expect(page.locator('.operator-strip')).toBeVisible();
        await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); document.body.setAttribute('data-theme', t); }, theme);
        await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '櫃台', exact: true }).click();
        const orders = page.getByTestId('cloud-orders-page');
        await orders.getByTestId('open-cash-movement-button').click();
        await expectTipInsideViewport(page, orders.getByTestId('cash-movement-card').getByRole('button', { name: '櫃台收支說明', exact: true }));
      });

      test('靠邊說明氣泡留在視窗內：補開帳說明', async ({ googleSession }) => {
        const { page } = googleSession;
        await clearLeftoverBusinessState();
        const unopened = await seedUnopenedPastDay();
        scenario = unopened;
        await page.getByRole('button', { name: '取得系統使用權' }).click();
        await expect(page.locator('.operator-strip')).toBeVisible();
        await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); document.body.setAttribute('data-theme', t); }, theme);
        await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '今日帳', exact: true }).click();
        const main = page.getByRole('main', { name: '雲端日結' });
        await main.getByTestId(`cloud-no-business-${unopened.dayId}`).click();
        await expectTipInsideViewport(page, main.getByRole('region', { name: '補開帳' }).getByRole('button', { name: '補開帳說明', exact: true }));
      });
    });
  }
}
