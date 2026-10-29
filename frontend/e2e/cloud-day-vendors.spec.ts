import { settings } from './helpers/navigation';
// P07 date, vendor, menu, and opening-cash workflow against the isolated Emulator.

import { test, expect } from './fixtures';
import { PROJECT, readAccessLease } from './helpers/seed';

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';

type AdminDocument = Record<string, unknown> & { id: string };

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function decodeAdminValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if ('stringValue' in raw) return raw.stringValue;
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return raw.doubleValue;
  if ('booleanValue' in raw) return raw.booleanValue;
  if ('nullValue' in raw) return null;
  if ('timestampValue' in raw) return raw.timestampValue;
  if ('mapValue' in raw) {
    const fields = (raw.mapValue as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    return decodeAdminFields(fields);
  }
  if ('arrayValue' in raw) {
    const values = (raw.arrayValue as { values?: unknown[] } | undefined)?.values ?? [];
    return values.map(decodeAdminValue);
  }
  return undefined;
}

function decodeAdminFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeAdminValue(value)]));
}

async function listAdminDocuments(collection: string): Promise<AdminDocument[]> {
  const documents: AdminDocument[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '100' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await fetch(
      `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?${query}`,
      { headers: { Authorization: 'Bearer owner' } },
    );
    if (!response.ok) throw new Error(`Failed to list Emulator ${collection}: ${await response.text()}`);
    const body = await response.json() as {
      documents?: Array<{ name?: string; fields?: Record<string, unknown> }>;
      nextPageToken?: string;
    };
    for (const document of body.documents ?? []) {
      const id = document.name?.split('/').at(-1);
      if (!id) throw new Error(`Emulator returned an invalid ${collection} document path`);
      documents.push({ id, ...decodeAdminFields(document.fields ?? {}) });
    }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return documents;
}

async function readAdminDocument(collection: string, documentId: string): Promise<AdminDocument | null> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(documentId)}`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to read Emulator ${collection}/${documentId}: ${await response.text()}`);
  const body = await response.json() as { name?: string; fields?: Record<string, unknown> };
  const id = body.name?.split('/').at(-1);
  if (!id) throw new Error(`Emulator returned an invalid document path for ${collection}/${documentId}`);
  return { id, ...decodeAdminFields(body.fields ?? {}) };
}

async function deleteAdminDocument(collection: string, documentId: string): Promise<void> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(documentId)}`,
    { method: 'DELETE', headers: { Authorization: 'Bearer owner' } },
  );
  if (!response.ok) throw new Error(`Failed to delete Emulator ${collection}/${documentId}: ${await response.text()}`);
}

async function resetDemoP07Data(head: 'p07-isolated' | 'global-empty'): Promise<void> {
  for (const collection of ['days', 'vendors', 'commands']) {
    const documents = await listAdminDocuments(collection);
    for (const document of documents) await deleteAdminDocument(collection, document.id);
  }

  // The P07 fixture starts one day earlier so D02 can create a previous source day; the
  // global-empty head matches e2e/global-setup.ts so later suites see their initial dataset.
  const isolated = head === 'p07-isolated';
  const goLiveDate = isolated ? shiftDate(taipeiToday(), -1) : taipeiToday();
  const fields: Record<string, Record<string, unknown>> = {
    schemaVersion: { integerValue: '1' },
    datasetId: { stringValue: isolated ? 'e2e-p07-d02-isolated' : 'e2e-empty-p06-dataset' },
    seq: { integerValue: '0' },
    lastCommandId: { nullValue: null },
    maintenance: { booleanValue: false },
    goLiveDate: { stringValue: goLiveDate },
    updatedAt: { timestampValue: new Date().toISOString() },
  };
  const mask = new URLSearchParams();
  for (const field of Object.keys(fields)) mask.append('updateMask.fieldPaths', field);
  const response = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/system/dataHead?${mask}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    },
  );
  if (!response.ok) throw new Error(`Failed to reset demo P07 dataHead: ${await response.text()}`);
}

test.describe('P07 Cloud day vendors', () => {
  test.beforeEach(async () => {
    // Demo Emulator only: keep operators and the shared access lease intact.
    await resetDemoP07Data('p07-isolated');
  });

  test.afterEach(async () => {
    // Remove P07 business documents and restore the global empty head for later suites.
    await resetDemoP07Data('global-empty');
  });

  test('operator creates today, an active vendor, a menu, and an explicitly confirmed zero opening', async ({ authedPage }) => {
    const page = authedPage;
    await settings(page, '菜單與開帳');

    const main = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
    await expect(main.getByRole('heading', { name: '菜單與開帳' })).toBeVisible();
    const dateField = main.getByLabel('查看或設定日期');
    const businessDate = await dateField.inputValue();
    expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.getByRole('button', { name: '建立空白營業日' }).click();
    const menuForm = main.getByRole('form', { name: `${businessDate} 菜單` });
    await expect(menuForm).toBeVisible();

    await page.keyboard.press('F4');
    await page.getByRole('button', { name: '新增供應商' }).click();
    const vendorForm = main.getByRole('form', { name: '新增供應商' });
    await vendorForm.getByLabel('供應商編號').fill('p07-ui-vendor-e2e');
    await vendorForm.getByLabel('供應商名稱').fill('P07 測試供應商');
    await vendorForm.getByRole('button', { name: '建立供應商' }).click();
    const vendorRow = page.getByTestId('cloud-vendor-row-p07-ui-vendor-e2e');
    await expect(vendorRow).toContainText('P07 測試供應商');
    await settings(page, '菜單與開帳');

    await menuForm.getByLabel('菜單名稱').fill('P07 測試餐盒');
    await menuForm.getByLabel('價格（新臺幣整數）').fill('135');
    await menuForm.getByLabel('供應商').selectOption('p07-ui-vendor-e2e');
    await menuForm.getByRole('button', { name: '儲存菜單' }).click();
    await expect(main.getByText('P07 測試餐盒')).toBeVisible();

    const openingForm = main.getByRole('form', { name: `${businessDate} 開帳現金` });
    await openingForm.getByLabel(/開帳現金/).fill('0');
    await openingForm.getByRole('button', { name: '確認開帳金額' }).click();
    await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 0/)).toBeVisible();
    await expect(main.getByText(/已確認 確認 .* 開帳現金 完成/)).toBeVisible();
  });

  test('D02: preserves earlier menu snapshots through vendor removal and supports a future direct menu only', async ({ authedPage }) => {
    test.setTimeout(60_000);
    const page = authedPage;
    const today = taipeiToday();
    const previousDate = shiftDate(today, -1);
    const futureDate = shiftDate(today, 1);
    const oldVendorId = 'p07-d02-old-vendor';
    const newVendorId = 'p07-d02-future-vendor';
    const operatorUid = (await readAccessLease()).holderUid;
    expect(operatorUid).toBeTruthy();

    await settings(page, '菜單與開帳');
    const main = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
    await expect(main.getByLabel('查看或設定日期')).toHaveValue(today);

    const dateField = main.getByLabel('查看或設定日期');
    await dateField.fill(previousDate);
    await main.getByRole('button', { name: '載入日期' }).click();
    await expect(main.getByRole('heading', { name: `${previousDate} 營業日` })).toBeVisible();
    await page.getByRole('button', { name: '建立空白營業日' }).click();
    await expect(main.getByRole('form', { name: `${previousDate} 菜單` })).toBeVisible();

    await page.keyboard.press('F4');
    await page.getByRole('button', { name: '新增供應商' }).click();
    const oldVendorForm = main.getByRole('form', { name: '新增供應商' });
    await oldVendorForm.getByLabel('供應商編號').fill(oldVendorId);
    await oldVendorForm.getByLabel('供應商名稱').fill('昨日供應商快照');
    await oldVendorForm.getByRole('button', { name: '建立供應商' }).click();
    await expect(page.getByTestId(`cloud-vendor-row-${oldVendorId}`)).toContainText('昨日供應商快照');
    await settings(page, '菜單與開帳');

    const previousMenuForm = main.getByRole('form', { name: `${previousDate} 菜單` });
    await previousMenuForm.getByLabel('菜單名稱').fill('昨日菜單快照');
    await previousMenuForm.getByLabel('價格（新臺幣整數）').fill('125');
    await previousMenuForm.getByLabel('供應商').selectOption(oldVendorId);
    await previousMenuForm.getByRole('button', { name: '儲存菜單' }).click();
    await expect(main.getByText('昨日菜單快照', { exact: true })).toBeVisible();
    const earlierDayBeforeLaterChanges = await readAdminDocument('days', previousDate);
    expect(earlierDayBeforeLaterChanges).toMatchObject({
      id: previousDate,
      menu: {
        businessDate: previousDate,
        itemName: '昨日菜單快照',
        price: 125,
        vendorId: oldVendorId,
        vendorNameSnapshot: '昨日供應商快照',
        inheritedFromDate: null,
      },
    });

    await dateField.fill(today);
    await main.getByRole('button', { name: '載入日期' }).click();
    await expect(main.getByRole('heading', { name: `${today} 營業日` })).toBeVisible();
    await page.getByRole('button', { name: '建立空白營業日' }).click();
    const todayMenuForm = main.getByRole('form', { name: `${today} 菜單` });
    await expect(todayMenuForm).toBeVisible();

    await page.getByRole('button', { name: '帶入最新較早菜單' }).click();
    await expect(main.getByText(new RegExp(`沿用來源已鎖定為 ${previousDate}`))).toBeVisible();
    await expect(todayMenuForm.getByLabel('菜單名稱')).toHaveValue('昨日菜單快照');
    await expect(todayMenuForm.getByLabel('菜單名稱')).toBeDisabled();
    await todayMenuForm.getByRole('button', { name: '儲存菜單' }).click();
    await expect(main.getByText('昨日菜單快照', { exact: true })).toBeVisible();
    let todayDay = await readAdminDocument('days', today);
    expect(todayDay?.menu).toMatchObject({
      businessDate: today,
      itemName: '昨日菜單快照',
      price: 125,
      vendorId: oldVendorId,
      vendorNameSnapshot: '昨日供應商快照',
      inheritedFromDate: previousDate,
    });

    const openingForm = main.getByRole('form', { name: `${today} 開帳現金` });
    await openingForm.getByLabel(/開帳現金/).fill('0');
    await openingForm.getByRole('button', { name: '確認開帳金額' }).click();
    await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 0/)).toBeVisible();
    const firstOpening = await readAdminDocument('days', today);
    expect(firstOpening).toMatchObject({ openingCash: 0, openedBy: operatorUid });
    expect(firstOpening?.openedAt).toEqual(expect.any(String));

    await openingForm.getByLabel(/開帳現金/).fill('20000');
    await openingForm.getByRole('button', { name: '更新開帳金額' }).click();
    await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 20,000/)).toBeVisible();
    const secondOpening = await readAdminDocument('days', today);
    expect(secondOpening).toMatchObject({ openingCash: 20_000, openedBy: firstOpening?.openedBy, openedAt: firstOpening?.openedAt });

    // Editing an inherited form turns it into an explicit direct assignment.
    await todayMenuForm.getByLabel('價格（新臺幣整數）').fill('175');
    await todayMenuForm.getByRole('button', { name: '儲存菜單' }).click();
    await expect(main.getByText('NT$ 175')).toBeVisible();
    todayDay = await readAdminDocument('days', today);
    expect(todayDay?.menu).toMatchObject({
      itemName: '昨日菜單快照',
      price: 175,
      vendorId: oldVendorId,
      vendorNameSnapshot: '昨日供應商快照',
      inheritedFromDate: null,
    });

    await page.keyboard.press('F4');
    const oldVendorRow = page.getByTestId(`cloud-vendor-row-${oldVendorId}`);
    await oldVendorRow.getByRole('button', { name: '編輯／停用／恢復' }).click();
    const editVendorForm = main.getByRole('form', { name: `編輯供應商 ${oldVendorId}` });
    await editVendorForm.getByLabel('狀態').selectOption('inactive');
    await editVendorForm.getByRole('button', { name: '儲存供應商' }).click();
    const inactiveVendorRow = page.getByTestId(`cloud-vendor-row-${oldVendorId}`);
    await expect(inactiveVendorRow).toContainText('已停用');
    await inactiveVendorRow.getByRole('button', { name: '移除' }).click();
    const removeForm = inactiveVendorRow.getByRole('form', { name: `移除供應商 ${oldVendorId}` });
    await removeForm.getByLabel(/移除原因/).fill('已確認結束合作');
    await removeForm.getByRole('button', { name: '確認移除' }).click();
    await expect(page.getByTestId(`cloud-vendor-row-${oldVendorId}`)).toHaveCount(0);
    await settings(page, '菜單與開帳');

    await dateField.fill(futureDate);
    await main.getByRole('button', { name: '載入日期' }).click();
    await expect(main.getByRole('heading', { name: `${futureDate} 營業日` })).toBeVisible();
    await page.getByRole('button', { name: '建立空白營業日' }).click();
    const futureMenuForm = main.getByRole('form', { name: `${futureDate} 菜單` });
    await expect(futureMenuForm).toBeVisible();
    await expect(main.getByText(/此日期可預排菜單，但不能預先開帳/)).toBeVisible();
    await expect(main.getByRole('form', { name: `${futureDate} 開帳現金` })).toHaveCount(0);

    await page.keyboard.press('F4');
    await page.getByRole('button', { name: '新增供應商' }).click();
    const futureVendorForm = main.getByRole('form', { name: '新增供應商' });
    await futureVendorForm.getByLabel('供應商編號').fill(newVendorId);
    await futureVendorForm.getByLabel('供應商名稱').fill('未來供應商');
    await futureVendorForm.getByRole('button', { name: '建立供應商' }).click();
    await expect(page.getByTestId(`cloud-vendor-row-${newVendorId}`)).toContainText('未來供應商');
    await settings(page, '菜單與開帳');
    await futureMenuForm.getByLabel('菜單名稱').fill('未來直接菜單');
    await futureMenuForm.getByLabel('價格（新臺幣整數）').fill('210');
    await futureMenuForm.getByLabel('供應商').selectOption(newVendorId);
    await futureMenuForm.getByRole('button', { name: '儲存菜單' }).click();
    await expect(main.getByText('未來直接菜單')).toBeVisible();
    await expect(main.getByRole('form', { name: `${futureDate} 開帳現金` })).toHaveCount(0);

    // Read-only Admin REST verification of the UI's real command receipts/projections.
    const earlierDayAfterLaterChanges = await readAdminDocument('days', previousDate);
    expect(earlierDayAfterLaterChanges).toEqual(earlierDayBeforeLaterChanges);
    const finalToday = await readAdminDocument('days', today);
    expect(finalToday).toMatchObject({
      menu: {
        itemName: '昨日菜單快照',
        price: 175,
        vendorId: oldVendorId,
        vendorNameSnapshot: '昨日供應商快照',
        inheritedFromDate: null,
      },
      openingCash: 20_000,
      openedBy: firstOpening?.openedBy,
      openedAt: firstOpening?.openedAt,
    });
    expect(await readAdminDocument('vendors', oldVendorId)).toMatchObject({
      vendorId: oldVendorId,
      name: '昨日供應商快照',
      status: 'inactive',
      deleted: true,
    });
    expect(await readAdminDocument('vendors', newVendorId)).toMatchObject({
      vendorId: newVendorId,
      name: '未來供應商',
      status: 'active',
      deleted: false,
    });
    expect(await readAdminDocument('days', futureDate)).toMatchObject({
      id: futureDate,
      menu: {
        itemName: '未來直接菜單',
        price: 210,
        vendorId: newVendorId,
        vendorNameSnapshot: '未來供應商',
        inheritedFromDate: null,
      },
      openingCash: null,
      openedBy: null,
      openedAt: null,
    });

    const commands = (await listAdminDocuments('commands')).sort((left, right) => Number(left.seq) - Number(right.seq));
    expect(commands.map(command => command.seq)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    expect(commands.find(command => command.kind === 'EnsureDay' && (command.targets as Record<string, unknown>).dayId === previousDate)).toMatchObject({
      kind: 'EnsureDay',
      actor: { uid: operatorUid },
      targets: { dayId: previousDate },
      payload: { businessDate: previousDate },
      after: { day: { menu: null, openingCash: null } },
    });
    expect(commands.find(command => command.kind === 'SetDayMenu' && command.businessDate === today && (command.payload as Record<string, unknown>).inheritedFromDate === previousDate)).toMatchObject({
      kind: 'SetDayMenu',
      payload: { selectionDate: today, inheritedFromDate: previousDate },
      after: { day: { menu: { businessDate: today, itemName: '昨日菜單快照', inheritedFromDate: previousDate } } },
    });
    expect(commands.find(command => command.kind === 'RemoveVendor')).toMatchObject({
      kind: 'RemoveVendor',
      reason: '已確認結束合作',
      payload: { reason: '已確認結束合作' },
      after: { vendor: { vendorId: oldVendorId, status: 'inactive', deleted: true } },
    });
    expect(commands.filter(command => command.kind === 'SetOpeningCash').map(command => (command.payload as Record<string, unknown>).openingCash))
      .toEqual([0, 20_000]);
    const openingReceipts = commands.filter(command => command.kind === 'SetOpeningCash');
    expect(openingReceipts).toHaveLength(2);
    expect(openingReceipts[0]).toMatchObject({
      seq: 6,
      actor: { uid: operatorUid },
      before: { day: { openingCash: null, openedBy: null, openedAt: null } },
      after: { day: { openingCash: 0, openedBy: operatorUid, openedAt: firstOpening?.openedAt } },
    });
    expect(openingReceipts[1]).toMatchObject({
      seq: 7,
      actor: { uid: operatorUid },
      before: { day: { openingCash: 0, openedBy: operatorUid, openedAt: firstOpening?.openedAt } },
      after: { day: { openingCash: 20_000, openedBy: operatorUid, openedAt: firstOpening?.openedAt } },
    });
    const finalHead = await readAdminDocument('system', 'dataHead');
    expect(finalHead).toMatchObject({ seq: 13, lastCommandId: commands.at(-1)?.commandId });
  });
});
