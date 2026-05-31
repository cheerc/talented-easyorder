import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { appendErrorLog, readErrorLog, clearErrorLog, getRecentErrors } from '../errorLogger';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('errorLogger', () => {
  it('appends entries and reads them back in LIFO order', () => {
    appendErrorLog({ source: 'react', message: 'test error A' });
    appendErrorLog({ source: 'window-error', message: 'test error B' });

    const entries = readErrorLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('test error B');
    expect(entries[1].message).toBe('test error A');
  });

  it('assigns id and createdAt to each entry', () => {
    const entry = appendErrorLog({ source: 'sync', message: 'sync error' });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    expect(new Date(entry.createdAt).getTime()).toBeGreaterThan(0);
  });

  it('caps entries at 100', () => {
    for (let i = 0; i < 150; i++) {
      appendErrorLog({ source: 'react', message: `error ${i}` });
    }
    expect(readErrorLog()).toHaveLength(100);
  });

  it('clears all entries', () => {
    appendErrorLog({ source: 'react', message: 'e1' });
    clearErrorLog();
    expect(readErrorLog()).toHaveLength(0);
  });

  it('sanitizes PII from message', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: '學生: 王小明, 餘額: 500, 金額: -90',
    });
    expect(entry.message).not.toContain('王小明');
    expect(entry.message).not.toContain('500');
    expect(entry.message).toContain('[REDACTED]');
  });

  it('sanitizes multi-word Chinese names', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: '學生: 歐陽大衛 餘額: 1200',
    });
    expect(entry.message).not.toContain('歐陽大衛');
    expect(entry.message).toContain('[REDACTED]');
  });

  it('sanitizes PII with mixed content', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: 'error: 學生: 林小明, 金額: -150, status: fail',
    });
    expect(entry.message).not.toContain('林小明');
    expect(entry.message).not.toContain('-150');
    expect(entry.message).toContain('status: fail');
  });

  it('sanitizes PII across multiple lines', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: 'Line 1\n學生: 張三 金額: 200\nLine 3',
    });
    expect(entry.message).not.toContain('張三');
    expect(entry.message).not.toContain('200');
  });

  it('sanitizes 姓名 and name patterns', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: '姓名: 李大華, name: John Smith, 學生: 王小明',
    });
    expect(entry.message).not.toContain('李大華');
    expect(entry.message).not.toContain('John Smith');
    expect(entry.message).not.toContain('王小明');
    expect(entry.message).toContain('[REDACTED]');
  });

  it('sanitizes context by allowlist', () => {
    const entry = appendErrorLog({
      source: 'storage',
      message: 'corrupt',
      context: {
        component: 'App',
        studentName: 'secret',
        balance: 999,
        businessDate: '2026-05-15',
        transactionType: 'order',
      },
    });
    expect(entry.context).toBeDefined();
    expect(entry.context!.component).toBe('App');
    expect(entry.context!.businessDate).toBe('2026-05-15');
    expect(entry.context!.transactionType).toBe('order');
    expect((entry.context as Record<string, unknown>).studentName).toBeUndefined();
    expect((entry.context as Record<string, unknown>).balance).toBeUndefined();
  });

  it('getRecentErrors returns entries', () => {
    appendErrorLog({ source: 'react', message: 'a' });
    appendErrorLog({ source: 'sync', message: 'b' });
    expect(getRecentErrors()).toHaveLength(2);
  });

  it('sanitizes PII from stack trace', () => {
    const entry = appendErrorLog({
      source: 'window-error',
      message: 'render error',
      stack: 'Error: 學生: 王小明 餘額: 500\n    at App (App.tsx:10:5)',
    });
    expect(entry.stack).not.toContain('王小明');
    expect(entry.stack).not.toContain('500');
    expect(entry.stack).toContain('[REDACTED]');
    expect(entry.stack).toContain('App.tsx:10:5');
  });

  it('does not match "filename" when sanitizing "name" pattern', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: 'filename: app.tsx load failed, name: John Smith',
    });
    expect(entry.message).toContain('filename: app.tsx');
    expect(entry.message).not.toContain('John Smith');
    expect(entry.message).toContain('name: [REDACTED]');
  });
});
