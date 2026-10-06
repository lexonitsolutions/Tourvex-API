import { ServiceType } from '../common/enums/service-type.enum';

export interface SupplierOffer {
  id: string;
  supplier: string;
  serviceType: ServiceType;
  title: string;
  destination: string;
  startsAt: string;
  endsAt?: string;
  available: number;
  unitPrice: number;
  currency: string;
  cancellation: { refundable: boolean; freeUntil?: string; policy: string };
  metadata: Record<string, string | number | boolean>;
}

export interface SupplierAdapter {
  search(input: {
    serviceType: ServiceType;
    destination: string;
    startDate: string;
    endDate?: string;
    travelers: number;
    currency: string;
  }): Promise<SupplierOffer[]>;
  reserve(offerId: string, travelers: number): Promise<{ reference: string; expiresAt: string }>;
  confirm(reference: string): Promise<{ confirmationNumber: string }>;
  cancel(reference: string): Promise<{ cancelled: boolean }>;
}
