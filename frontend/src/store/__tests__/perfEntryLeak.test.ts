import { describe, it, expect, beforeEach } from 'vitest';

describe('#322 — PerformanceEntry leak prevention', () => {
  beforeEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('clearMeasures removes pos-transaction entries after measure', () => {
    performance.mark('test-start');
    performance.mark('test-end');
    performance.measure('pos-transaction', 'test-start', 'test-end');

    // Before clearing, entry exists
    expect(performance.getEntriesByName('pos-transaction', 'measure').length).toBe(1);

    // After clearing (simulating what orderActions does)
    performance.clearMarks('test-start');
    performance.clearMarks('test-end');
    performance.clearMeasures('pos-transaction');

    // Entries should be gone
    expect(performance.getEntriesByName('pos-transaction', 'measure').length).toBe(0);
    expect(performance.getEntriesByName('test-start', 'mark').length).toBe(0);
    expect(performance.getEntriesByName('test-end', 'mark').length).toBe(0);
  });

  it('without clearMeasures, entries accumulate', () => {
    for (let i = 0; i < 5; i++) {
      performance.mark(`m-${i}-start`);
      performance.mark(`m-${i}-end`);
      performance.measure('pos-transaction', `m-${i}-start`, `m-${i}-end`);
      performance.clearMarks(`m-${i}-start`);
      performance.clearMarks(`m-${i}-end`);
      // NOT clearing measures — entries accumulate
    }
    expect(performance.getEntriesByName('pos-transaction', 'measure').length).toBe(5);

    // After clearing, all gone
    performance.clearMeasures('pos-transaction');
    expect(performance.getEntriesByName('pos-transaction', 'measure').length).toBe(0);
  });
});
