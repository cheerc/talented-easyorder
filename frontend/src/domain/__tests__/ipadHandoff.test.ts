import { describe, it, expect } from 'vitest';
import {
  validateIpadHandoffMessage,
  toHandoffScannerInput,
  writeHandoffIntent,
  readHandoffIntent,
} from '../ipadHandoff';
import type { IpadHandoffMessage } from '../ipadHandoff';

const validMessage: IpadHandoffMessage = {
  version: 1,
  timestamp: Date.now(),
  action: 'order',
  studentId: '015',
  sourceDevice: 'ipad_handoff',
};

describe('validateIpadHandoffMessage', () => {
  it('accepts a valid handoff message', () => {
    const result = validateIpadHandoffMessage(validMessage);
    expect(result.ok).toBe(true);
  });

  it('rejects message without studentId', () => {
    const result = validateIpadHandoffMessage({ ...validMessage, studentId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing_student_id');
  });

  it('rejects unknown action', () => {
    const result = validateIpadHandoffMessage({ ...validMessage, action: 'unknown' as IpadHandoffMessage['action'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_action');
  });

  it('rejects wrong version', () => {
    const result = validateIpadHandoffMessage({ ...validMessage, version: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_version');
  });

  it('rejects missing timestamp', () => {
    const result = validateIpadHandoffMessage({ ...validMessage, timestamp: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_timestamp');
  });

  it('rejects message with non-ipad source', () => {
    const result = validateIpadHandoffMessage({
      ...validMessage,
      sourceDevice: 'barcode_scanner' as IpadHandoffMessage['sourceDevice'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });
});

describe('toHandoffScannerInput', () => {
  it('converts handoff message to ScannerInput', () => {
    const input = toHandoffScannerInput(validMessage);
    expect(input.rawCode).toBe('015');
    expect(input.terminator).toBe('Enter');
  });

  it('trims whitespace from studentId', () => {
    const input = toHandoffScannerInput({ ...validMessage, studentId: ' 015 ' });
    expect(input.rawCode).toBe('015');
  });
});

describe('handoff intent write/read cycle', () => {
  it('writes and reads handoff intent via specified channel', () => {
    const channel = 'test-handoff-channel';
    writeHandoffIntent(channel, validMessage);
    const read = readHandoffIntent(channel);
    expect(read).not.toBeNull();
    expect(read!.studentId).toBe('015');
    expect(read!.action).toBe('order');
    expect(read!.version).toBe(1);
    expect(read!.timestamp).toBe(validMessage.timestamp);
    expect(read!.sourceDevice).toBe('ipad_handoff');
  });

  it('readHandoffIntent returns null when no data written', () => {
    const result = readHandoffIntent('nonexistent-channel');
    expect(result).toBeNull();
  });

  it('readHandoffIntent clears the stored data after reading', () => {
    const channel = 'consume-test-channel';
    writeHandoffIntent(channel, validMessage);
    const first = readHandoffIntent(channel);
    expect(first).not.toBeNull();
    const second = readHandoffIntent(channel);
    expect(second).toBeNull();
  });

  it('handles malformed stored data gracefully', () => {
    const channel = 'malformed-channel';
    sessionStorage.setItem(channel, 'not-json');
    const result = readHandoffIntent(channel);
    expect(result).toBeNull();
  });

  it('rejects crafted object with wrong field types (no unsafe cast)', () => {
    const channel = 'crafted-channel';
    sessionStorage.setItem(channel, JSON.stringify({
      version: '1',
      timestamp: 'bad',
      action: 'invalid',
      studentId: 123,
      sourceDevice: 'not-valid',
    }));
    const result = readHandoffIntent(channel);
    expect(result).toBeNull();
  });

  it('rejects object missing required fields', () => {
    const channel = 'missing-fields-channel';
    sessionStorage.setItem(channel, JSON.stringify({
      version: 1,
      action: 'order',
    }));
    const result = readHandoffIntent(channel);
    expect(result).toBeNull();
  });
});

describe('handoff message expiration', () => {
  it('rejects a message older than 30 seconds', () => {
    const expiredMessage: IpadHandoffMessage = {
      version: 1,
      timestamp: Date.now() - 40_000,
      action: 'order',
      studentId: '015',
      sourceDevice: 'ipad_handoff',
    };
    const result = validateIpadHandoffMessage(expiredMessage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('expired');
  });

  it('accepts a message within the 30-second window', () => {
    const freshMessage: IpadHandoffMessage = {
      version: 1,
      timestamp: Date.now(),
      action: 'order',
      studentId: '015',
      sourceDevice: 'ipad_handoff',
    };
    const result = validateIpadHandoffMessage(freshMessage);
    expect(result.ok).toBe(true);
  });
});
