import { createHash, randomUUID } from 'node:crypto';
import { ServiceType } from '../common/enums/service-type.enum';
import { SupplierAdapter, SupplierOffer } from './supplier.types';

const BASE_PRICES: Record<ServiceType, number> = {
  [ServiceType.Flight]: 950,
  [ServiceType.Hotel]: 420,
  [ServiceType.Activity]: 180,
  [ServiceType.Visa]: 350,
  [ServiceType.Transfer]: 120,
};

export class MockSupplierAdapter implements SupplierAdapter {
  search(input: {
    serviceType: ServiceType;
    destination: string;
    startDate: string;
    endDate?: string;
    travelers: number;
    currency: string;
  }): Promise<SupplierOffer[]> {
    const seed = createHash('sha256')
      .update(`${input.serviceType}:${input.destination}:${input.startDate}`)
      .digest()[0];
    return Promise.resolve(Array.from({ length: 5 }, (_, index) => {
      const unitPrice = BASE_PRICES[input.serviceType] + seed + index * 37;
      return {
        id: `mock_${input.serviceType}_${seed}_${index + 1}`,
        supplier: 'tourvex-mock-supplier',
        serviceType: input.serviceType,
        title: `${input.destination} ${this.label(input.serviceType)} ${index + 1}`,
        destination: input.destination,
        startsAt: input.startDate,
        endsAt: input.endDate,
        available: 12 - index,
        unitPrice,
        currency: input.currency.toUpperCase(),
        cancellation: {
          refundable: index < 4,
          freeUntil: index < 4 ? this.daysBefore(input.startDate, 2) : undefined,
          policy: index < 4 ? 'Free cancellation until 48 hours before service.' : 'Non-refundable.',
        },
        metadata: { mock: true, travelers: input.travelers },
      };
    }));
  }

  reserve(_offerId: string, _travelers: number) {
    return Promise.resolve({ reference: `RSV-${randomUUID()}`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
  }

  confirm(_reference: string) {
    return Promise.resolve({ confirmationNumber: `CNF-${randomUUID()}` });
  }

  cancel(_reference: string) {
    return Promise.resolve({ cancelled: true });
  }

  private label(serviceType: ServiceType) {
    return {
      [ServiceType.Flight]: 'flight',
      [ServiceType.Hotel]: 'hotel stay',
      [ServiceType.Activity]: 'experience',
      [ServiceType.Visa]: 'visa service',
      [ServiceType.Transfer]: 'private transfer',
    }[serviceType];
  }

  private daysBefore(value: string, days: number) {
    const date = new Date(value);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
  }
}
