import { describe, expect, it } from 'vitest';
import { placeUnder } from './locations';
import type { Location, LocationWithPath } from './types';

const lakeSebu: LocationWithPath = {
  psgc_code: '1206319000',
  parent_code: '1206300000',
  level: 'municipality',
  name: 'Lake Sebu',
  display_name: 'Lake Sebu, South Cotabato',
  path: [
    { psgc_code: '1200000000', parent_code: null, level: 'region', name: 'SOCCSKSARGEN' },
    { psgc_code: '1206300000', parent_code: '1200000000', level: 'province', name: 'South Cotabato' },
  ],
};

// A row exactly as GET /locations?parent= sends it: no display_name, no path.
const poblacion: Location = { psgc_code: '1206319014', parent_code: '1206319000', level: 'barangay', name: 'Poblacion' };

describe('placeUnder', () => {
  it('names a bare child row the way search would have', () => {
    const b = placeUnder(poblacion, lakeSebu);
    expect(b.display_name).toBe('Poblacion, Lake Sebu, South Cotabato');
    expect(b.psgc_code).toBe('1206319014');
    expect(b.level).toBe('barangay');
  });

  it('gives it a path the caller can read the municipality out of', () => {
    const b = placeUnder(poblacion, lakeSebu);
    expect(b.path?.map((p) => p.level)).toEqual(['region', 'province', 'municipality']);
    expect(b.path?.find((p) => p.level === 'municipality')?.name).toBe('Lake Sebu');
  });

  it('copes with a parent that has no path of its own', () => {
    const b = placeUnder(poblacion, { ...lakeSebu, path: undefined });
    expect(b.display_name).toBe('Poblacion, Lake Sebu, South Cotabato');
    expect(b.path).toHaveLength(1);
  });
});
