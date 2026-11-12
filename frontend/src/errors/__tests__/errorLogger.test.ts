import { describe, expect, it } from 'vitest';
import { sanitizeMessage, sanitizeStack } from '../errorLogger';

// #709：自由文字 logger（prototype 專用）已移除；appendErrorLog 只寫安全診斷（見 safeDiagnostics.test.ts）。
// 這裡保留仍被使用的去識別化函式（ErrorBoundary 用 sanitizeMessage）。
describe('sanitizeMessage', () => {
  it('sanitizes PII from message', () => {
    const message = sanitizeMessage('學生: 王小明, 餘額: 500, 金額: -90');
    expect(message).not.toContain('王小明');
    expect(message).not.toContain('500');
    expect(message).toContain('[REDACTED]');
  });

  it('sanitizes multi-word Chinese names', () => {
    const message = sanitizeMessage('學生: 歐陽大衛 餘額: 1200');
    expect(message).not.toContain('歐陽大衛');
    expect(message).toContain('[REDACTED]');
  });

  it('sanitizes PII with mixed content', () => {
    const message = sanitizeMessage('error: 學生: 林小明, 金額: -150, status: fail');
    expect(message).not.toContain('林小明');
    expect(message).not.toContain('-150');
    expect(message).toContain('status: fail');
  });

  it('sanitizes PII across multiple lines', () => {
    const message = sanitizeMessage('Line 1\n學生: 張三 金額: 200\nLine 3');
    expect(message).not.toContain('張三');
    expect(message).not.toContain('200');
  });

  it('sanitizes 姓名 and name patterns', () => {
    const message = sanitizeMessage('姓名: 李大華, name: John Smith, 學生: 王小明');
    expect(message).not.toContain('李大華');
    expect(message).not.toContain('John Smith');
    expect(message).not.toContain('王小明');
    expect(message).toContain('[REDACTED]');
  });

  it('does not redact single address character (avoid false positives)', () => {
    const message = sanitizeMessage('路徑錯誤: file not found');
    expect(message).toContain('路徑錯誤');
    expect(message).not.toContain('[ADDR REDACTED]');
  });

  it('redacts address patterns (number+addr char or 2+ consecutive addr chars)', () => {
    const message = sanitizeMessage('地址: 台北市大安區忠孝東路四段100號11樓');
    expect(message).not.toContain('100號');
    expect(message).not.toContain('11樓');
    expect(message).toContain('[ADDR REDACTED]');
  });

  it('does not match "filename" when sanitizing "name" pattern', () => {
    const message = sanitizeMessage('filename: app.tsx load failed, name: John Smith');
    expect(message).toContain('filename: app.tsx');
    expect(message).not.toContain('John Smith');
    expect(message).toContain('name: [REDACTED]');
  });
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
