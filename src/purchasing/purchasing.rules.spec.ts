import { computeLine, computeTotals, dueDateFor, formatPurchaseNumber, fromMinor, isOverdue, lastUnitCosts, toMinor } from './purchasing.rules';

describe('computeLine', () => {
  it('adds quantity to every date of the range and prices total units x unit cost', () => {
    const line = computeLine({ quantity: 10, dateFrom: '2026-11-01', dateTo: '2026-11-03', unitCost: 12.5 });
    expect(line.dates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(line.totalUnits).toBe(30);
    expect(line.lineTotal).toBe(375);
    expect(line.taxAmount).toBe(0);
  });

  it('keeps only the selected weekdays (0 = Sunday)', () => {
    // 2026-11-01 is a Sunday.
    const line = computeLine({ quantity: 4, dateFrom: '2026-11-01', dateTo: '2026-11-14', weekdays: [0, 6], unitCost: 3 });
    expect(line.dates).toEqual(['2026-11-01', '2026-11-07', '2026-11-08', '2026-11-14']);
    expect(line.totalUnits).toBe(16);
    expect(line.lineTotal).toBe(48);
  });

  it('rounds the line total in minor units, not in floating point', () => {
    expect(computeLine({ quantity: 3, dateFrom: '2026-11-01', dateTo: '2026-11-01', unitCost: 0.1 }).lineTotal).toBe(0.3);
    expect(computeLine({ quantity: 7, dateFrom: '2026-11-01', dateTo: '2026-11-03', unitCost: 19.99 }).lineTotal).toBe(419.79);
  });

  it('computes the line tax from the percent', () => {
    const line = computeLine({ quantity: 10, dateFrom: '2026-11-01', dateTo: '2026-11-01', unitCost: 10.01, taxPercent: 5 });
    expect(line.lineTotal).toBe(100.1);
    expect(line.taxAmount).toBe(5.01);
  });

  it('rejects bad ranges with the stock error codes', () => {
    const code = (input: Parameters<typeof computeLine>[0]) => {
      try {
        computeLine(input);
      } catch (error) {
        return (error as { code?: string }).code;
      }
      return undefined;
    };
    const base = { quantity: 1, unitCost: 1 };
    expect(code({ ...base, dateFrom: '2026-02-30', dateTo: '2026-03-01' })).toBe('INVALID_DATE');
    expect(code({ ...base, dateFrom: '2026-11-05', dateTo: '2026-11-01' })).toBe('INVALID_RANGE');
    expect(code({ ...base, dateFrom: '2026-01-01', dateTo: '2026-06-01' })).toBe('RANGE_TOO_LARGE');
    expect(code({ ...base, dateFrom: '2026-11-02', dateTo: '2026-11-03', weekdays: [0] })).toBe('NO_MATCHING_DAYS');
  });

  it('allows exactly 93 days and refuses 94', () => {
    expect(computeLine({ quantity: 1, unitCost: 1, dateFrom: '2026-11-01', dateTo: '2027-02-01' }).dates).toHaveLength(93);
    expect(() => computeLine({ quantity: 1, unitCost: 1, dateFrom: '2026-11-01', dateTo: '2027-02-02' })).toThrow();
  });
});

describe('computeTotals', () => {
  it('adds lines and tax in minor units', () => {
    expect(computeTotals([{ lineTotal: 0.1, taxAmount: 0.01 }, { lineTotal: 0.2, taxAmount: 0.02 }])).toEqual({ subtotal: 0.3, taxTotal: 0.03, total: 0.33 });
    expect(computeTotals([])).toEqual({ subtotal: 0, taxTotal: 0, total: 0 });
  });
});

describe('helpers', () => {
  it('formats gap-free purchase numbers', () => {
    expect(formatPurchaseNumber(2026, 1)).toBe('PUR-2026-000001');
    expect(formatPurchaseNumber('2026', 1234567)).toBe('PUR-2026-1234567');
  });

  it('converts money to minor units and back', () => {
    expect(toMinor(1.005)).toBe(101);
    expect(fromMinor(toMinor(19.99))).toBe(19.99);
  });

  it('derives the due date from the payment terms', () => {
    expect(dueDateFor('2026-10-10', 30)).toBe('2026-11-09');
    expect(dueDateFor('2026-10-10', 0)).toBeUndefined();
  });

  it('flags only received purchases past their due date', () => {
    expect(isOverdue('received', '2026-10-09', '2026-10-10')).toBe(true);
    expect(isOverdue('received', '2026-10-10', '2026-10-10')).toBe(false);
    expect(isOverdue('paid', '2026-10-01', '2026-10-10')).toBe(false);
    expect(isOverdue('received', undefined, '2026-10-10')).toBe(false);
  });

  it('takes the last unit cost per item', () => {
    const costs = lastUnitCosts([{ itemId: 'a', unitCost: 1 }, { itemId: 'b', unitCost: 2 }, { itemId: 'a', unitCost: 3 }]);
    expect(costs.get('a')).toBe(3);
    expect(costs.get('b')).toBe(2);
  });
});
