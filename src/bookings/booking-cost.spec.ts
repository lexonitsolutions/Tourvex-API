import { buildCostSnapshot } from './booking-cost';

describe('buildCostSnapshot', () => {
  const at = new Date('2026-10-10T08:00:00Z');

  it('is policy unit cost x units', () => {
    expect(buildCostSnapshot(12.5, 3, 'AED', at)).toEqual({ unitCost: 12.5, quantity: 3, total: 37.5, currency: 'AED', source: 'policy', at });
  });

  it('rounds the total in minor units', () => {
    expect(buildCostSnapshot(19.99, 7, 'AED', at)?.total).toBe(139.93);
    expect(buildCostSnapshot(0.1, 3, 'AED', at)?.total).toBe(0.3);
  });

  it('is null without a unit cost, but zero is a real cost', () => {
    expect(buildCostSnapshot(null, 2, 'AED', at)).toBeNull();
    expect(buildCostSnapshot(undefined, 2, 'AED', at)).toBeNull();
    expect(buildCostSnapshot(0, 2, 'AED', at)).toMatchObject({ unitCost: 0, total: 0 });
  });
});
