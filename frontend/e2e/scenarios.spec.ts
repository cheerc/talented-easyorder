// #669：具名業務情境 fixture 的驗證 spec。
// 每個 scenario 用 Admin REST 建立「前置狀態」，再從真 App 進入，斷言畫面確實到達該狀態；
// 被測行為（停用、恢復、移除供應商）一律走 UI 正式命令。只使用 demo-easyorder Emulator 與合成資料。
import { test, expect } from './fixtures';
import { accountCheck } from './helpers/navigation';
import { seedAccessLease } from './helpers/seed';
import {
  assertDayAbsent,
  seedAdjacentCashGap,
  seedBackfillInProgress,
  seedOpenDayWithMenu,
  seedOpenDayWithoutMenu,
  seedPendingCommand,
  seedUnclosedPastDays,
  seedUnopenedPastDay,
  seedVendors,
  taipeiToday,
  shiftDay,
} from './helpers/scenarios';
import type { Page } from '@playwright/test';

const VACANT_LEASE = { holderUid: null, epoch: 0 };
const today = taipeiToday();

async function acquire(page: Page) {
  await page.getByRole('button', { name: '取得系統使用權' }).click();
  await expect(page.locator('.operator-strip')).toBeVisible();
}

function mainNav(page: Page, name: string) {
  return page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name, exact: true });
}

test.describe('具名業務情境 fixtures', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });
  test.afterEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test.describe('使用「今天」的情境', () => {
    // 不覆寫別的 suite 留下的狀態：今天的營業日已存在就直接失敗。
    test.beforeEach(async () => { await assertDayAbsent(today); });

    test('F1a：今天已開帳且有菜單，櫃台雙欄、份數統計與收支卡可見', async ({ googleSession }) => {
      const { page } = googleSession;
      const scenario = await seedOpenDayWithMenu();
      try {
        await acquire(page);
        await mainNav(page, '櫃台').click();
        const orders = page.getByTestId('cloud-orders-page');
        await expect(orders.getByTestId('cloud-topbar-counts')).toBeVisible();
        await expect(orders.getByTestId('cloud-topbar-bento')).toContainText(scenario.menuName);
        await expect(orders.getByTestId('orders-menu-unavailable')).toHaveCount(0);
        await expect(orders.getByText('今日尚未設定菜單')).toHaveCount(0);
        const content = orders.locator('.cloud-orders__content');
        const columns = content.locator(':scope > *');
        await expect(columns).toHaveCount(2);
        const [left, right] = await Promise.all([columns.nth(0).boundingBox(), columns.nth(1).boundingBox()]);
        expect(Math.abs(left!.y - right!.y)).toBeLessThanOrEqual(1);
        expect(right!.x).toBeGreaterThan(left!.x + left!.width - 1);
        // 合成學生可從搜尋找到（P3–P5 的回歸測試共用）。
        await orders.getByLabel('搜尋編號、姓名或別名').fill(scenario.studentCode);
        await expect(orders.getByTestId(`search-result-${scenario.studentCode}`)).toContainText(scenario.studentName);
        // 櫃台收支卡：按「櫃台收支」開啟後可見。
        await orders.getByTestId('open-cash-movement-button').click();
        await expect(orders.getByTestId('cash-movement-card')).toBeVisible();
      } finally {
        await scenario.cleanup();
      }
      await assertDayAbsent(today);
    });

    test('F1b：今天已開帳但沒有菜單，顯示「今日尚未設定菜單」', async ({ googleSession }) => {
      const { page } = googleSession;
      const scenario = await seedOpenDayWithoutMenu();
      try {
        await acquire(page);
        await mainNav(page, '櫃台').click();
        const orders = page.getByTestId('cloud-orders-page');
        await expect(orders.getByText('今日尚未設定菜單')).toBeVisible();
        await expect(orders.getByTestId('cloud-topbar-bento')).toContainText('未設定');
      } finally {
        await scenario.cleanup();
      }
      await assertDayAbsent(today);
    });

    test('草稿捨棄：菜單有未送出的內容時改日期會先確認；取消保留草稿，捨棄才載入新日期', async ({ googleSession }) => {
      const { page } = googleSession;
      const scenario = await seedOpenDayWithMenu();
      const nextDay = shiftDay(today, 1);
      try {
        await acquire(page);
        await mainNav(page, '今日設定').click();
        await page.getByRole('navigation', { name: '今日設定' }).getByRole('button', { name: '菜單與開帳', exact: true }).click();
        const main = page.getByRole('main').first();
        const menuName = main.getByLabel('菜單名稱');
        await expect(menuName).toHaveValue(scenario.menuName);
        await menuName.fill('合成未送出菜單');
        const date = main.getByLabel('查看或設定日期');
        await date.fill(nextDay);
        const dialog = page.getByRole('dialog', { name: '捨棄草稿？' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: '取消' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(menuName).toHaveValue('合成未送出菜單');
        await expect(date).toHaveValue(today);
        await date.fill(nextDay);
        await page.getByRole('dialog', { name: '捨棄草稿？' }).getByRole('button', { name: '捨棄並載入' }).click();
        await expect(main.getByRole('heading', { name: `${nextDay} 營業日` })).toBeVisible();
      } finally {
        await scenario.cleanup();
      }
      await assertDayAbsent(today);
    });
  });

  test('F2a：有未關帳的過去營業日，今日帳出現對應的日期 chips', async ({ googleSession }) => {
    const { page } = googleSession;
    const scenario = await seedUnclosedPastDays(3);
    try {
      expect(scenario.days).toHaveLength(3);
      await acquire(page);
      await mainNav(page, '今日帳').click();
      const main = page.getByRole('main', { name: '雲端日結' });
      for (const day of scenario.days) await expect(main.getByTestId(`cloud-unclosed-${day}`)).toBeVisible();
      await expect(main.locator('.cloud-day-close__chip:not(.cloud-day-close__chip--quiet)')).toHaveCount(3);
      await expect(main.getByText('過去有 3 天還沒關帳')).toBeVisible();
    } finally {
      await scenario.cleanup();
    }
  });

  test('F2a：未關帳超過 5 天時只列 5 個 chips，其餘導向帳務檢查', async ({ googleSession }) => {
    const { page } = googleSession;
    const scenario = await seedUnclosedPastDays(6);
    try {
      await acquire(page);
      await mainNav(page, '今日帳').click();
      const main = page.getByRole('main', { name: '雲端日結' });
      await expect(main.getByText('過去有 6 天還沒關帳')).toBeVisible();
      await expect(main.locator('.cloud-day-close__chip:not(.cloud-day-close__chip--quiet)')).toHaveCount(5);
      await expect(main.getByText('另有 1 天')).toBeVisible();
    } finally {
      await scenario.cleanup();
    }
  });

  test('補開帳：過去日存在但未開帳，日結頁出現「補開帳」卡與說明', async ({ googleSession }) => {
    const { page } = googleSession;
    const scenario = await seedUnopenedPastDay();
    try {
      await acquire(page);
      await mainNav(page, '今日帳').click();
      const main = page.getByRole('main', { name: '雲端日結' });
      await main.getByTestId(`cloud-no-business-${scenario.dayId}`).click();
      await expect(main.getByRole('heading', { name: `${scenario.dayId} 日結` })).toBeVisible();
      const card = main.getByRole('region', { name: '補開帳' });
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: '補開帳說明' })).toBeVisible();
    } finally {
      await scenario.cleanup();
    }
  });

  test('回填中：櫃台可切換到回填日並顯示回填橫幅', async ({ googleSession }) => {
    const { page } = googleSession;
    const scenario = await seedBackfillInProgress();
    try {
      await acquire(page);
      await mainNav(page, '櫃台').click();
      const orders = page.getByTestId('cloud-orders-page');
      const select = orders.getByTestId('orders-day-select');
      await expect(select).toBeVisible();
      await expect(orders.getByTestId('backfill-banner')).toHaveCount(0);
      await select.selectOption(scenario.dayId);
      await expect(orders.getByTestId('backfill-banner')).toContainText(`正在回填 ${scenario.dayId}（原因：${scenario.reason}）`);
    } finally {
      await scenario.cleanup();
    }
  });

  test('F4：供應商停用、恢復、移除都走 UI 正式命令', async ({ googleSession }) => {
    const { page } = googleSession;
    const scenario = await seedVendors();
    try {
      await acquire(page);
      await mainNav(page, '供應商').click();
      const active = page.getByTestId(`cloud-vendor-row-${scenario.activeId}`);
      const inactive = page.getByTestId(`cloud-vendor-row-${scenario.inactiveId}`);
      await expect(active).toContainText(scenario.activeName);
      await expect(active).toContainText('使用中');
      await expect(inactive).toContainText('已停用');

      // 停用
      await active.getByRole('button', { name: '編輯／停用／恢復' }).click();
      const main = page.getByRole('main').first();
      let form = main.getByRole('form', { name: `編輯供應商 ${scenario.activeId}` });
      await form.getByLabel('狀態').selectOption('inactive');
      await form.getByRole('button', { name: '儲存供應商' }).click();
      await expect(page.getByTestId(`cloud-vendor-row-${scenario.activeId}`)).toContainText('已停用');

      // 恢復（新涵蓋）
      await page.getByTestId(`cloud-vendor-row-${scenario.inactiveId}`).getByRole('button', { name: '編輯／停用／恢復' }).click();
      form = main.getByRole('form', { name: `編輯供應商 ${scenario.inactiveId}` });
      await form.getByLabel('狀態').selectOption('active');
      await form.getByRole('button', { name: '儲存供應商' }).click();
      await expect(page.getByTestId(`cloud-vendor-row-${scenario.inactiveId}`)).toContainText('使用中');

      // 移除（只有已停用的可以移除）
      const removable = page.getByTestId(`cloud-vendor-row-${scenario.activeId}`);
      await removable.getByRole('button', { name: '移除' }).click();
      const removeForm = removable.getByRole('form', { name: `移除供應商 ${scenario.activeId}` });
      await removeForm.getByLabel(/移除原因/).fill('合成情境：結束合作');
      await removeForm.getByRole('button', { name: '確認移除' }).click();
      await expect(page.getByTestId(`cloud-vendor-row-${scenario.activeId}`)).toHaveCount(0);
      await expect(page.getByTestId(`cloud-vendor-row-${scenario.inactiveId}`)).toBeVisible();
    } finally {
      await scenario.cleanup();
    }
  });

  test('R1：相鄰營業日帳差，頂部出現「異常 1」且帳務檢查有補記捷徑', async ({ googleSession }) => {
    const { page } = googleSession;
    const scenario = await seedAdjacentCashGap();
    try {
      await acquire(page);
      await expect(page.getByRole('button', { name: '異常 1' })).toBeVisible();
      await accountCheck(page);
      await expect(page.getByTestId(`post-close-shortcut-${scenario.newerDay}`)).toBeVisible();
    } finally {
      await scenario.cleanup();
    }
  });

  test('R2：待核對命令在取得使用權後顯示命令編號', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const scenario = await seedPendingCommand(page, uid);
    try {
      await acquire(page);
      const pending = page.locator('.cloud-pending-recovery');
      await expect(pending.getByText(scenario.commandId)).toBeVisible();
    } finally {
      await scenario.cleanup();
    }
  });
});
