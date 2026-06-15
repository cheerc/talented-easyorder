import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { appendErrorLog, readErrorLog, clearErrorLog, sanitizeStack } from '../errorLogger';

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

  it('readErrorLog returns entries', () => {
    appendErrorLog({ source: 'react', message: 'a' });
    appendErrorLog({ source: 'sync', message: 'b' });
    expect(readErrorLog()).toHaveLength(2);
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

  it('does not redact single address character (avoid false positives)', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: '路徑錯誤: file not found',
    });
    expect(entry.message).toContain('路徑錯誤');
    expect(entry.message).not.toContain('[ADDR REDACTED]');
  });

  it('redacts address patterns (number+addr char or 2+ consecutive addr chars)', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: '地址: 台北市大安區忠孝東路四段100號11樓',
    });
    expect(entry.message).not.toContain('100號');
    expect(entry.message).not.toContain('11樓');
    expect(entry.message).toContain('[ADDR REDACTED]');
  });

  it('sanitizes string values in allowlisted context keys', () => {
    const entry = appendErrorLog({
      source: 'react',
      message: 'test',
      context: {
        errorHint: '學生: 王小明 電話0912-345-678',
      },
    });
    expect(entry.context).toBeDefined();
    expect(entry.context!.errorHint).toBeDefined();
    expect(entry.context!.errorHint).not.toContain('王小明');
    expect(entry.context!.errorHint).not.toContain('0912-345-678');
    expect(entry.context!.errorHint).toContain('[REDACTED]');
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

  describe('sanitizeStack (#288)', () => {
    it('strips Unix absolute file paths from stack traces', () => {
      const stack = 'Error: fail\n    at Module (/Users/cheerc/talented-easyorder/frontend/src/App.tsx:42:5)';
      const result = sanitizeStack(stack);
      expect(result).not.toContain('/Users/cheerc');
      expect(result).toContain('[PATH]');
    });

    it('strips Windows file paths from stack traces', () => {
      const stack = 'Error: fail\n    at C:\\Users\\dev\\project\\src\\index.ts:10:3';
      const result = sanitizeStack(stack);
      expect(result).not.toContain('C:\\Users\\dev');
      expect(result).toContain('[PATH]');
    });

    it('strips node_modules paths', () => {
      const stack = 'at node_modules/firebase/auth/dist/index.js:123:45';
      const result = sanitizeStack(stack);
      expect(result).not.toContain('node_modules/firebase');
      expect(result).toContain('[MODULE]');
    });

    it('also applies message sanitization (PII patterns)', () => {
      const stack = 'Error: 學生: 王小明\n    at /Users/cheerc/src/App.tsx:1:1';
      const result = sanitizeStack(stack);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('王小明');
    });
  });

  describe('TTL rotation (#288)', () => {
    it('removes entries older than 24 hours', () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();

      // Manually seed localStorage with old + recent entries
      const entries = [
        { id: 'recent-1', createdAt: recent, source: 'react', message: 'recent' },
        { id: 'old-1', createdAt: old, source: 'react', message: 'old' },
      ];
      localStorage.setItem('easyorder-error-log', JSON.stringify(entries));

      // Append a new entry — should trigger TTL rotation
      appendErrorLog({ source: 'react', message: 'new entry' });

      const log = readErrorLog();
      expect(log.some(e => e.id === 'old-1')).toBe(false);
      expect(log.some(e => e.id === 'recent-1')).toBe(true);
      expect(log.some(e => e.message === 'new entry')).toBe(true);
    });

    it('keeps entries within 24 hours', () => {
      const fresh = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const entries = [
        { id: 'fresh-1', createdAt: fresh, source: 'react', message: 'fresh' },
      ];
      localStorage.setItem('easyorder-error-log', JSON.stringify(entries));

      appendErrorLog({ source: 'react', message: 'another' });

      const log = readErrorLog();
      expect(log.some(e => e.id === 'fresh-1')).toBe(true);
    });
  });
});
