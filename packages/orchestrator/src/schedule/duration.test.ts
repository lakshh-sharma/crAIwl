import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from './duration.js';

describe('parseDuration', () => {
  it('parses seconds, minutes, hours, days', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('5m')).toBe(5 * 60_000);
    expect(parseDuration('2h')).toBe(2 * 3_600_000);
    expect(parseDuration('1d')).toBe(86_400_000);
  });

  it('is case insensitive on the unit', () => {
    expect(parseDuration('10M')).toBe(parseDuration('10m'));
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDuration('  3 h  ')).toBe(3 * 3_600_000);
  });

  it('throws on bad input', () => {
    expect(() => parseDuration('5 minutes')).toThrow();
    expect(() => parseDuration('abc')).toThrow();
    expect(() => parseDuration('5y')).toThrow();
  });
});

describe('formatDuration', () => {
  it('round-trips through clean intervals', () => {
    expect(formatDuration(86_400_000)).toBe('1d');
    expect(formatDuration(2 * 3_600_000)).toBe('2h');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration(30_000)).toBe('30s');
  });
});
