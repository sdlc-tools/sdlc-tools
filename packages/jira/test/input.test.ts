import { describe, expect, it } from 'vitest';
import { parseDate, parseDuration, parseIssueKey, parseStarted } from '../src/input.js';

describe('parseIssueKey', () => {
  it('accepts keys of any case and normalises them', () => {
    expect(parseIssueKey(' abc-12 ')).toBe('ABC-12');
    expect(parseIssueKey('A1_B-7')).toBe('A1_B-7');
  });

  it.each(['', 'ABC', '12', 'ABC-', 'ABC-1/../x', '1ABC-1', 'ABC 1'])('rejects %j', (value) => {
    expect(() => parseIssueKey(value)).toThrow(/not an issue key/);
  });
});

describe('parseStarted', () => {
  it.each([
    ['2026-03-02T09:00:00+09:00', '2026-03-02T09:00:00.000+0900'],
    ['2026-03-02T09:00+0900', '2026-03-02T09:00:00.000+0900'],
    ['2026-03-02T00:00:00Z', '2026-03-02T00:00:00.000+0000'],
    ['2026-03-02T09:00:00.5-05:30', '2026-03-02T09:00:00.500-0530'],
    ['2026-03-02T09:00:00.123Z', '2026-03-02T09:00:00.123+0000'],
  ])('converts %s', (input, expected) => {
    expect(parseStarted(input)).toBe(expected);
  });

  it.each([
    '2026-03-02',
    '2026-03-02T09:00:00',
    '2026-13-02T09:00:00Z',
    '2026-03-02T25:00:00Z',
    '2026-03-02T09:00:00+25:00',
    'yesterday',
  ])('rejects %j', (value) => {
    expect(() => parseStarted(value)).toThrow(/offset/);
  });
});

describe('parseDuration', () => {
  it.each([
    ['30m', '30m'],
    ['1W 2d  3h 4M', '1w 2d 3h 4m'],
    ['2h30m', '2h30m'],
  ])('accepts %j', (input, expected) => {
    expect(parseDuration(input, 'x')).toBe(expected);
  });

  it.each(['', '1.5h', 'h', '2 hours', '-1h', '1x'])('rejects %j', (value) => {
    expect(() => parseDuration(value, 'The time')).toThrow(/not a duration/);
  });
});

describe('parseDate', () => {
  it('accepts real dates including leap days', () => {
    expect(parseDate('2028-02-29', '--due')).toBe('2028-02-29');
  });

  it.each(['2026-02-29', '2026-13-01', '2026-1-1', '26-01-01', ''])('rejects %j', (value) => {
    expect(() => parseDate(value, '--due')).toThrow(/YYYY-MM-DD/);
  });
});
