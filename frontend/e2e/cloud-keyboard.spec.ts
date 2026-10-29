import { release } from './helpers/navigation';
import { test, expect } from './fixtures';
import { upsertDocument, PROJECT } from './helpers/seed';

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function documents(collection: string) {
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${collection}`, { headers: { Authorization: 'Bearer owner' } });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json() as { documents?: unknown[] }).documents ?? [];
}

test('101 keyboard payment produces one confirmed effect and returns to search', async ({ googleSession }) => {
  const { page, uid } = googleSession;
  const date = today();
  const studentId = 'd1000000-0000-4000-8000-000000000101';
  const seedId = 'd2000000-0000-4000-8000-000000000101';
  await upsertDocument('students', studentId, {
    studentId, studentCode: '101', displayName: '鍵盤測試甲', aliases: [], status: 'active',
    openingBalance: { amount: 300, asOfDate: date, note: '', createdAt: new Date() },
    currentBalance: 300, createdAt: new Date(), revision: 1, lastCommandId: seedId, updatedAt: new Date(),
  });
  await upsertDocument('studentCodes', '101', { studentId, lastCommandId: seedId, updatedAt: new Date() });
  await upsertDocument('days', date, {
    status: 'open', revision: 1, menu: { businessDate: date, itemName: '測試餐點', price: 90, vendorId: 'test-vendor', vendorNameSnapshot: '測試供應商', updatedAt: new Date(), revision: 1, inheritedFromDate: null },
    openingCash: 1000, openedBy: uid, openedAt: new Date(),
    totals: { activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 },
    lastSettlementRevision: 0, lastCommandId: seedId, updatedAt: new Date(),
  });
  await page.getByRole('button', { name: '取得系統使用權' }).click();
  await page.getByRole('button', { name: '櫃台' }).click();
  await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);
  await page.locator('body').click({ position: { x: 2, y: 500 } });
  await page.keyboard.type('101');
  const search = page.getByRole('combobox', { name: '搜尋編號、姓名或別名' });
  await expect(search).toHaveValue('101');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-student-card')).toContainText('鍵盤測試甲');
  await expect(page.getByLabel('實收金額（留空為 0 元）')).toBeFocused();
  if (process.env.EASYORDER_EVIDENCE_DIR) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: `${process.env.EASYORDER_EVIDENCE_DIR}/selected-1920.png` });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: `${process.env.EASYORDER_EVIDENCE_DIR}/selected-1366.png` });
  }
  await page.keyboard.press('w');
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/已確認 101 鍵盤測試甲 繳費 .* 完成/)).toBeVisible();
  await expect(page.getByTestId('undo-bar')).toBeVisible();
  expect(await documents('commands')).toHaveLength(1);
  expect(await documents('transactions')).toHaveLength(1);
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  expect(await documents('commands')).toHaveLength(1);
  await release(page);
});

test('multiple candidates move only through visible options and reset on a new query', async ({ googleSession }) => {
  const { page } = googleSession;
  const date = today();
  const beforeCommands = await documents('commands');
  const seedId = 'd2000000-0000-4000-8000-000000000102';
  for (let i = 0; i < 3; i++) {
    const code = String(201 + i);
    const studentId = `d1000000-0000-4000-8000-00000000010${2 + i}`;
    await upsertDocument('students', studentId, {
      studentId, studentCode: code, displayName: `相似測試${i}`, aliases: [], status: 'active',
      openingBalance: { amount: 0, asOfDate: date, note: '', createdAt: new Date() },
      currentBalance: 0, createdAt: new Date(), revision: 1, lastCommandId: seedId, updatedAt: new Date(),
    });
    await upsertDocument('studentCodes', code, { studentId, lastCommandId: seedId, updatedAt: new Date() });
  }
  const acquire = page.getByRole('button', { name: '取得系統使用權' });
  await expect(acquire.or(page.locator('.operator-strip'))).toBeVisible();
  if (await acquire.isVisible()) await acquire.click();
  await page.getByRole('button', { name: '櫃台' }).click();
  const search = page.getByRole('combobox', { name: '搜尋編號、姓名或別名' });
  await search.fill('相似測試');
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 2, y: 500 } });
  await page.keyboard.type('2');
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  const firstCode = (await options.nth(0).locator('strong').textContent())!;
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-student-card')).toContainText(firstCode);
  expect(await documents('commands')).toHaveLength(beforeCommands.length);
  await page.keyboard.press('Escape');
  await search.fill('相似測試0');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-student-card')).toContainText('相似測試0');
  expect(await documents('commands')).toHaveLength(beforeCommands.length);
  await release(page);
});
