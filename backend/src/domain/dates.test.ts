import { describe, expect, it } from 'vitest';
import { isJsParseableDate, normalizeDate } from './dates.js';

describe('normalizeDate', () => {
  it('passes through the GrowEasy sample format', () => {
    expect(normalizeDate('2026-05-13 14:20:48')).toBe('2026-05-13 14:20:48');
  });

  it('reads ISO 8601 with a timezone and normalizes to UTC', () => {
    expect(normalizeDate('2026-05-13T14:20:48Z')).toBe('2026-05-13 14:20:48');
    expect(normalizeDate('2026-05-13T20:20:48+05:30')).toBe('2026-05-13 14:50:48');
  });

  it('reads a bare ISO date', () => {
    expect(normalizeDate('2026-05-13')).toBe('2026-05-13 00:00:00');
  });

  it('reads day-first numeric dates, the common non-US export shape', () => {
    expect(normalizeDate('29-06-2026 10:00')).toBe('2026-06-29 10:00:00');
    expect(normalizeDate('29/06/2026')).toBe('2026-06-29 00:00:00');
    expect(normalizeDate('05/06/2026')).toBe('2026-06-05 00:00:00');
  });

  it('flips to month-first when day-first is impossible', () => {
    // 06/29/2026 — 29 cannot be a month.
    expect(normalizeDate('06/29/2026')).toBe('2026-06-29 00:00:00');
  });

  it('rejects a date that does not exist', () => {
    expect(normalizeDate('31-02-2026')).toBe('');
    expect(normalizeDate('45/45/2026')).toBe('');
  });

  it('reads Excel serial numbers', () => {
    // 45000 days after 1899-12-30.
    expect(normalizeDate('45000')).toBe('2023-03-15 00:00:00');
  });

  it('reads Unix timestamps in seconds and milliseconds', () => {
    expect(normalizeDate('1747145048')).toBe('2025-05-13 14:04:08');
    expect(normalizeDate('1747145048000')).toBe('2025-05-13 14:04:08');
  });

  it('reads human-written dates', () => {
    expect(normalizeDate('May 13, 2026')).toBe('2026-05-13 00:00:00');
  });

  it('returns blank for junk rather than a wrong date', () => {
    expect(normalizeDate('')).toBe('');
    expect(normalizeDate('not a date')).toBe('');
    expect(normalizeDate('tomorrow')).toBe('');
  });

  it('always emits something new Date() can parse', () => {
    const inputs = [
      '2026-05-13 14:20:48',
      '29-06-2026 10:00',
      'May 13, 2026',
      '45000',
      'garbage',
      '',
    ];
    for (const input of inputs) {
      expect(isJsParseableDate(normalizeDate(input))).toBe(true);
    }
  });
});
