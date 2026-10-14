import { describe, expect, it } from 'vitest';
import {
  buildTransactionDoc,
  cloudStudentToStudentAccount,
  cloudTransactionToLedgerTransaction,
  SCHEMA_VERSION_V1,
  validateCloudStudentDoc,
  validateCloudTransactionDoc,
  validateStudentDoc,
  type CloudStudentDoc,
  type CloudTransactionDoc,
  type TransactionDocInput,
} from '../firestoreSchema';

describe('firestoreSchema: 新舊 Schema 型別與 Adapter 驗證', () => {
  it('舊版 buildTransactionDoc 與 validateStudentDoc 維持相容', () => {
    const legacyInput: TransactionDocInput = {
      id: 'tx-old',
      studentId: 'stu-1',
      studentNameSnapshot: '舊學員',
      type: 'order',
      amount: -90,
      balanceBefore: 100,
      balanceAfter: 10,
      clientBalanceAfterPreview: 10,
      menuNameSnapshot: '排骨飯',
      price: 90,
      paidAmount: 0,
      operatorId: 'op-1',
      operatorEmail: 'op@example.com',
      deviceId: 'dev-1',
      businessDate: '2026-10-14',
      sourceDevice: 'pc',
      note: '',
      status: 'synced',
    };

    const built = buildTransactionDoc(legacyInput);
    expect(built.id).toBe('tx-old');
    expect(built.createdAt).toBeDefined();

    expect(validateStudentDoc({ status: 'active', revision: 1 }).ok).toBe(true);
    expect(validateStudentDoc({ status: 'unknown', revision: 1 }).ok).toBe(false);
  });

  it('新版 SCHEMA_VERSION_V1 常數為 1', () => {
    expect(SCHEMA_VERSION_V1).toBe(1);
  });

  it('cloudTransactionToLedgerTransaction 正確轉換新版交易 Doc', () => {
    const cloudDoc: CloudTransactionDoc = {
      transactionId: 'tx-cloud-1',
      studentId: 'stu-cloud',
      businessDate: '2026-10-14',
      type: 'order',
      mealKind: 'other',
      mealPrice: 95,
      paidAmount: 100,
      amount: 5,
      studentNameSnapshot: '雲端學員',
      menuNameSnapshot: '素食餐點',
      menuPriceSnapshot: 95,
      vendorIdSnapshot: 'ven-1',
      otherItemName: '素食餐點',
      vendorNameSnapshot: '蔬食坊',
      status: 'active',
      revision: 1,
      createdAt: '2026-10-14T10:00:00.000Z' as unknown as CloudTransactionDoc['createdAt'],
      createdSeq: 1,
      operatorUid: 'uid-op-1',
      operatorEmail: 'op@example.test',
      sourceDevice: 'pc',
      note: '無蔥',
      lastCommandId: 'cmd-1',
      updatedAt: '2026-10-14T10:00:00.000Z' as unknown as CloudTransactionDoc['updatedAt'],
    };

    const ledgerTx = cloudTransactionToLedgerTransaction(cloudDoc, 105);
    expect(ledgerTx.transactionId).toBe('tx-cloud-1');
    expect(ledgerTx.afterBalance).toBe(105);
    expect(ledgerTx.otherItemName).toBe('素食餐點');
    expect(ledgerTx.operatorId).toBe('uid-op-1');
    expect(ledgerTx.syncStatus).toBe('synced');
  });

  it('cloudStudentToStudentAccount 正確轉換新版學員 Doc', () => {
    const cloudStudent: CloudStudentDoc = {
      studentId: 'stu-cloud-1',
      displayName: '王小明',
      aliases: ['小明'],
      status: 'active',
      openingBalance: {
        amount: 200,
        asOfDate: '2026-10-14',
        note: '轉帳期初',
        createdAt: '2026-10-14T08:00:00.000Z' as unknown as CloudStudentDoc['createdAt'],
      },
      currentBalance: 200,
      createdAt: '2026-10-14T08:00:00.000Z' as unknown as CloudStudentDoc['createdAt'],
      revision: 1,
      lastCommandId: 'cmd-create-stu',
      updatedAt: '2026-10-14T08:00:00.000Z' as unknown as CloudStudentDoc['updatedAt'],
    };

    const account = cloudStudentToStudentAccount(cloudStudent);
    expect(account.studentId).toBe('stu-cloud-1');
    expect(account.displayName).toBe('王小明');
    expect(account.openingBalance?.amount).toBe(200);
    expect(account.openingBalance?.asOfDate).toBe('2026-10-14');
  });

  it('新版 Doc 驗證函式運作正常', () => {
    expect(
      validateCloudStudentDoc({
        studentId: 'stu-1',
        displayName: '測試',
        status: 'active',
        currentBalance: 0,
        revision: 1,
      }).ok,
    ).toBe(true);

    expect(
      validateCloudStudentDoc({
        studentId: '',
        displayName: '測試',
        status: 'active',
        currentBalance: 0,
        revision: 1,
      }).ok,
    ).toBe(false);

    expect(
      validateCloudTransactionDoc({
        transactionId: 'tx-1',
        type: 'order',
        status: 'active',
        revision: 1,
      }).ok,
    ).toBe(true);

    expect(
      validateCloudTransactionDoc({
        transactionId: 'tx-1',
        type: 'invalid-type',
        status: 'active',
        revision: 1,
      }).ok,
    ).toBe(false);
  });
});
