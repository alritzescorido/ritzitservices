import { describe, expect, it } from 'vitest';
import { ago, day, money, unitLabel } from './format';
import { query } from './client';

describe('format', () => {
  it('formats pesos from decimal strings', () => {
    expect(money('177.00')).toBe('₱177.00');
    expect(money('165240.5')).toBe('₱165,240.50');
    expect(money(null)).toBe('—');
    expect(money('abc')).toBe('abc');
  });
  it('formats dates in Manila', () => {
    expect(day('2026-09-13')).toMatch(/13 Sept? 2026|Sep 13, 2026/);
    expect(day(null)).toBe('—');
  });
  it('describes elapsed time', () => {
    expect(ago(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5 min');
    expect(ago(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3 hours');
    expect(ago(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe('3 days');
  });
  it('labels units', () => {
    expect(unitLabel('per_kg_liveweight')).toBe('/kg');
    expect(unitLabel('per_head')).toBe('/head');
  });
});

describe('query', () => {
  it('drops empty values and encodes the rest', () => {
    expect(query({ a: 1, b: '', c: undefined, d: 'x y', e: false })).toBe('?a=1&d=x+y&e=false');
    expect(query({})).toBe('');
  });
});
