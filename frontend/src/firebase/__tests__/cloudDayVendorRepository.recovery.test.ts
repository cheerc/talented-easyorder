import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  createCloudDayVendorRepository,
  type EnsureDayInput,
  type RemoveVendorInput,
  type SaveVendorInput,
  type SetDayMenuInput,
  type SetOpeningCashInput,
} from '../cloudDayVendorRepository';

type TestIntent =
  | { kind: 'ensure-day'; input: EnsureDayInput }
  | { kind: 'save-vendor'; input: SaveVendorInput }
  | { kind: 'remove-vendor'; input: RemoveVendorInput }
  | { kind: 'set-day-menu'; input: SetDayMenuInput }
  | { kind: 'set-opening-cash'; input: SetOpeningCashInput };

const commands = vi.hoisted(() => ({
  commitCommand: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
  readCommand: vi.fn(),
}));

const ledger = vi.hoisted(() => ({
  findPreviousClosed: vi.fn(),
}));

vi.mock('../cloudCommandRepository', () => ({
  createCloudCommandRepository: () => commands,
}));

vi.mock('../cloudDayCloseRepository', () => ({
  CloudDayCloseRepositoryError: class CloudDayCloseRepositoryError extends Error {
    code = 'UNKNOWN_RESULT';
  },
  createCloudLedgerReader: () => ledger,
}));

const recoveryReader = { assertCurrent: vi.fn() };
const repository = () => createCloudDayVendorRepository({} as Firestore, { recoveryReader: recoveryReader as never });

const intents: TestIntent[] = [
  { kind: 'ensure-day', input: { commandId: '10000000-0000-4000-8000-000000000001', leaseEpoch: 7, dayId: '2026-10-20' } },
  { kind: 'save-vendor', input: {
    commandId: '10000000-0000-4000-8000-000000000002', leaseEpoch: 7,
    vendorId: 'vendor-a', expectedRevision: 0, name: '供應商', phone: '02-1234', note: '備註', status: 'active',
  } },
  { kind: 'remove-vendor', input: {
    commandId: '10000000-0000-4000-8000-000000000003', leaseEpoch: 7,
    vendorId: 'vendor-a', expectedRevision: 4, reason: '停止合作',
  } },
  { kind: 'set-day-menu', input: {
    commandId: '10000000-0000-4000-8000-000000000004', leaseEpoch: 7,
    dayId: '2026-10-20', selectionDate: '2026-10-15', expectedRevision: 5, expectedHeadSeq: 92,
    itemName: '預排餐盒', price: 180, vendorId: 'vendor-a', vendorNameSnapshot: '供應商', inheritedFromDate: '2026-10-14',
  } },
  { kind: 'set-opening-cash', input: {
    commandId: '10000000-0000-4000-8000-000000000005', leaseEpoch: 7,
    dayId: '2026-10-15', expectedRevision: 2, openingCash: 1000, reason: '核對紙本後調整',
  } },
];

function canonical(intent: TestIntent) {
  if (intent.kind === 'ensure-day') return {
    commandId: intent.input.commandId, kind: 'EnsureDay', leaseEpoch: intent.input.leaseEpoch,
    targets: { dayId: intent.input.dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: intent.input.dayId },
  };
  if (intent.kind === 'save-vendor') return {
    commandId: intent.input.commandId, kind: 'SaveVendor', leaseEpoch: intent.input.leaseEpoch,
    targets: { vendorId: intent.input.vendorId }, expectedRevisions: { vendor: intent.input.expectedRevision },
    payload: {
      vendorId: intent.input.vendorId, name: intent.input.name, phone: intent.input.phone,
      note: intent.input.note, status: intent.input.status,
    },
  };
  if (intent.kind === 'remove-vendor') return {
    commandId: intent.input.commandId, kind: 'RemoveVendor', leaseEpoch: intent.input.leaseEpoch,
    targets: { vendorId: intent.input.vendorId }, expectedRevisions: { vendor: intent.input.expectedRevision },
    payload: { reason: intent.input.reason },
  };
  if (intent.kind === 'set-day-menu') return {
    commandId: intent.input.commandId, kind: 'SetDayMenu', leaseEpoch: intent.input.leaseEpoch,
    targets: { dayId: intent.input.dayId },
    expectedRevisions: { day: intent.input.expectedRevision, headSeq: intent.input.expectedHeadSeq },
    payload: {
      selectionDate: intent.input.selectionDate, itemName: intent.input.itemName, price: intent.input.price,
      vendorId: intent.input.vendorId, vendorNameSnapshot: intent.input.vendorNameSnapshot,
      inheritedFromDate: intent.input.inheritedFromDate,
    },
  };
  const reason = intent.input.reason?.trim();
  return {
    commandId: intent.input.commandId, kind: 'SetOpeningCash', leaseEpoch: intent.input.leaseEpoch,
    targets: { dayId: intent.input.dayId }, expectedRevisions: { day: intent.input.expectedRevision },
    payload: reason ? { openingCash: intent.input.openingCash, reason } : { openingCash: intent.input.openingCash },
  };
}

describe('CloudDayVendorRepository recovery intent mapping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    commands.commitCommand.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    commands.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    commands.cleanupConfirmedIntent.mockResolvedValue(true);
    ledger.findPreviousClosed.mockResolvedValue({ previous: null });
  });

  it.each(intents)('uses the same canonical input for writer and read-only confirmation: %s', async intent => {
    const subject = repository();
    await subject.confirmPendingIntent(intent, 'dataset-a', 'uid-a');
    expect(commands.confirmPendingIntent).toHaveBeenCalledWith(
      canonical(intent), intent.input.leaseEpoch, 'dataset-a', 'uid-a', recoveryReader,
    );
    expect(commands.commitCommand).not.toHaveBeenCalled();
    expect(ledger.findPreviousClosed).not.toHaveBeenCalled();

    await subject.commitDayVendorIntent(intent);
    expect(commands.commitCommand).toHaveBeenNthCalledWith(1, canonical(intent));

    if (intent.kind === 'ensure-day') await subject.ensureDay(intent.input);
    else if (intent.kind === 'save-vendor') await subject.saveVendor(intent.input);
    else if (intent.kind === 'remove-vendor') await subject.removeVendor(intent.input);
    else if (intent.kind === 'set-day-menu') await subject.setDayMenu(intent.input);
    else await subject.setOpeningCash(intent.input);
    expect(commands.commitCommand).toHaveBeenNthCalledWith(2, canonical(intent));
  });

  it('preserves trimmed optional opening reason semantics without repeating writer preflight during confirmation', async () => {
    const subject = repository();
    const intent: TestIntent = {
      kind: 'set-opening-cash',
      input: {
        commandId: '10000000-0000-4000-8000-000000000006', leaseEpoch: 7,
        dayId: '2026-10-15', expectedRevision: 2, openingCash: 1000, reason: '  核對紙本後調整  ',
      },
    };
    await subject.confirmPendingIntent(intent, 'dataset-a', 'uid-a');
    expect(commands.confirmPendingIntent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { openingCash: 1000, reason: '核對紙本後調整' } }),
      7, 'dataset-a', 'uid-a', recoveryReader,
    );
    expect(ledger.findPreviousClosed).not.toHaveBeenCalled();

    await subject.setOpeningCash(intent.input);
    expect(ledger.findPreviousClosed).toHaveBeenCalledWith('2026-10-15');
    expect(commands.commitCommand).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'SetOpeningCash', payload: { openingCash: 1000, reason: '核對紙本後調整' },
    }));
  });

  it('returns invalid normalized opening input as a command result instead of throwing', async () => {
    const subject = repository();
    const result = await subject.setOpeningCash({
      commandId: '10000000-0000-4000-8000-000000000008', leaseEpoch: 7,
      dayId: '2026-10-15', expectedRevision: 2, openingCash: 650, reason: 'x'.repeat(501),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(commands.commitCommand).not.toHaveBeenCalled();
  });

  it('reruns the fresh closed-day preflight for every explicit opening-cash commit retry', async () => {
    const subject = repository();
    const intent: TestIntent = {
      kind: 'set-opening-cash',
      input: {
        commandId: '10000000-0000-4000-8000-000000000007', leaseEpoch: 7,
        dayId: '2026-10-15', expectedRevision: 2, openingCash: 1000, reason: '核對紙本後調整',
      },
    };
    ledger.findPreviousClosed.mockResolvedValue({ previous: { dayId: '2026-10-13', countedCash: 870 }, seq: 12 });

    await subject.confirmPendingIntent(intent, 'dataset-a', 'uid-a');
    expect(ledger.findPreviousClosed).not.toHaveBeenCalled();

    await subject.commitDayVendorIntent(intent);
    await subject.commitDayVendorIntent(intent);

    expect(ledger.findPreviousClosed).toHaveBeenCalledTimes(2);
    expect(ledger.findPreviousClosed).toHaveBeenNthCalledWith(1, intent.input.dayId);
    expect(ledger.findPreviousClosed).toHaveBeenNthCalledWith(2, intent.input.dayId);
    expect(commands.commitCommand).toHaveBeenCalledTimes(2);
    expect(commands.commitCommand).toHaveBeenNthCalledWith(1, canonical(intent));
    expect(commands.commitCommand).toHaveBeenNthCalledWith(2, canonical(intent));
  });

  it('delegates exact confirmed cleanup to the shared command boundary', async () => {
    const subject = repository();
    const intent = intents[3];
    const isCurrent = vi.fn(() => true);
    await subject.cleanupConfirmedIntent(intent, 'dataset-a', 'uid-a', isCurrent);
    expect(commands.cleanupConfirmedIntent).toHaveBeenCalledWith(
      canonical(intent), intent.input.leaseEpoch, 'dataset-a', 'uid-a', recoveryReader, isCurrent,
    );
  });
});
