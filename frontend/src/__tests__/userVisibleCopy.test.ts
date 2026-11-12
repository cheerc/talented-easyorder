import { describe, expect, it } from 'vitest';

/**
 * #691 P8 copy guard. The operator is told what happened and what to do in everyday words: the screens, messages and errors
 * of the app never talk about 「使用權／租約／世代／持有人」 or show an 「Epoch」. This reads the source text of every production
 * module under `src/` (comments are ignored; tests and `src/maintenance/`, the Node CLI that never ships in the bundle, are
 * not scanned) and lists every line that still carries one of those words.
 *
 * Not covered on purpose: identifiers such as `leaseEpoch` or `holderUid` (not visible), and the raw account id that the
 * not-approved screen shows so that the maintainer can approve the account (spec §4.1).
 */
const sources = import.meta.glob(
  [
    '../**/*.{ts,tsx}',
    '!../**/__tests__/**',
    '!../**/*.{test,spec}.{ts,tsx}',
    '!../test/**',
    '!../maintenance/**',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const FORBIDDEN = /使用權|租約|世代|持有人|\bEpoch\b/;

/** Removes block comments and line comments; a `//` inside a string literal (for example a URL) is kept. */
function stripComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ''));
  return withoutBlocks.split('\n').map(line => {
    let quote: string | null = null;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      if (quote) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      } else if (char === '/' && line[index + 1] === '/') {
        return line.slice(0, index);
      }
    }
    return line;
  }).join('\n');
}

describe('#691 P8: user-visible copy', () => {
  it('scans the production sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(90);
    expect(Object.keys(sources).some(key => key.endsWith('/auth/AuthGate.tsx'))).toBe(true);
    expect(Object.keys(sources).some(key => key.includes('/maintenance/'))).toBe(false);
  });

  it('never says 使用權, 租約, 世代, 持有人 or Epoch outside comments', () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      stripComments(text).split('\n').forEach((line, index) => {
        if (FORBIDDEN.test(line)) offenders.push(`${file.replace(/^\.\.\//, 'src/')}:${index + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('never states that another person certainly logged in where the cause can also be a lapsed login or the same account (#691 P9)', () => {
    // LEASE_LOST also happens when the same account released from another tab or re-acquired its own expired lease.
    const unhedged: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      stripComments(text).split('\n').forEach((line, index) => {
        if (/其他人已登入，這個頁面已停止操作/.test(line)) unhedged.push(`${file.replace(/^\.\.\//, 'src/')}:${index + 1}`);
      });
    }
    expect(unhedged).toEqual([]);
  });
});
