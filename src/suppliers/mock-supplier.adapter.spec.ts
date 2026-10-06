import { ServiceType } from '../common/enums/service-type.enum';
import { MockSupplierAdapter } from './mock-supplier.adapter';

describe('MockSupplierAdapter', () => {
  const adapter = new MockSupplierAdapter();

  it('returns deterministic searchable offers for every product vertical', async () => {
    for (const serviceType of Object.values(ServiceType)) {
      const input = {
        serviceType,
        destination: 'Dubai',
        startDate: '2026-12-10T00:00:00.000Z',
        travelers: 2,
        currency: 'AED',
      };
      const first = await adapter.search(input);
      const second = await adapter.search(input);
      expect(first).toHaveLength(5);
      expect(second).toEqual(first);
      expect(first[0]).toMatchObject({ serviceType, destination: 'Dubai', currency: 'AED' });
    }
  });
});
