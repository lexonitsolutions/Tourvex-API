import { Injectable } from '@nestjs/common';
import { appError } from '../common/app-error';
import { EventsService } from '../events/events.service';
import { VisasService } from '../visas/visas.service';
import { priceTravellers } from './checkout-pricing';
import type { PreparedItem } from '../catalog/catalog.service';

export type PackageType = 'visa' | 'event';

/** Resolves non-activity cart lines from live catalogue data. The browser never supplies a trusted price. */
@Injectable()
export class PackageCartService {
  constructor(
    private readonly visas: VisasService,
    private readonly events: EventsService,
  ) {}

  async prepare(type: PackageType, slug: string, input: { optionId: string; date: string; adults: number; children: number; nationality?: string; residence?: string; minorAges?: number[] }): Promise<PreparedItem> {
    const data: any = type === 'visa'
      ? (await this.visas.findBySlug(slug)).visa
      : (await this.events.findBySlug(slug)).event;

    if (!data.allowAddToCart) throw appError(409, 'CART_DISABLED', 'Add to Cart is not available for this package');
    if (data.stock?.soldOut) throw appError(409, 'PACKAGE_UNAVAILABLE', 'This package is currently unavailable');

    let optionName = 'Standard package';
    let amount = data.salePrice?.amount ?? data.price?.amount;
    let refundable = false;
    let childAmount: number | undefined;
    if (type === 'visa') {
      if (input.date < new Date().toISOString().slice(0, 10)) throw appError(409, 'DATE_UNAVAILABLE', 'Please choose a future travel date');
      if (!input.nationality || !input.residence) throw appError(400, 'TRAVELLER_DETAILS_REQUIRED', 'Nationality and residence are required');
      if ((data.eligibleNationalities?.length ?? 0) && !data.eligibleNationalities.includes(input.nationality)) throw appError(409, 'VISA_INELIGIBLE', 'This visa is not available for the selected nationality');
      if ((data.eligibleResidences?.length ?? 0) && !data.eligibleResidences.includes(input.residence)) throw appError(409, 'VISA_INELIGIBLE', 'This visa is not available for the selected country of residence');
      if (input.children !== (input.minorAges?.length ?? 0)) throw appError(400, 'MINOR_AGES_REQUIRED', 'Please provide the age of every minor');
      const maxAge = data.minorMaxAge ?? 17;
      if ((input.minorAges ?? []).some((age: number) => age < 0 || age > maxAge)) throw appError(400, 'MINOR_AGE_INVALID', `Minor ages must be between 0 and ${maxAge}`);
      const choices = (data.processingOptions ?? []).filter((o: any) => o.enabled !== false);
      const selected = choices.find((o: any) => this.key(o.id) === input.optionId) ?? (input.optionId === 'standard' ? choices[0] : null) ?? (choices.length ? null : { id: 'normal', name: 'Normal processing', estimatedTime: data.processing, fee: null });
      if (!selected) throw appError(409, 'PACKAGE_UNAVAILABLE', 'The selected processing type is unavailable');
      optionName = selected.name;
      const processingFee = selected.fee?.amount ?? 0;
      const serviceCharge = data.serviceCharge?.amount ?? 0;
      const adultBase = data.adultPrice?.amount ?? data.startingPrice?.amount;
      const childBase = data.minorPrice?.amount ?? adultBase;
      amount = typeof adultBase === 'number' ? adultBase + processingFee : undefined;
      childAmount = typeof childBase === 'number' ? childBase + processingFee : undefined;
      if (typeof amount === 'number') amount += serviceCharge / Math.max(1, input.adults + input.children);
      if (typeof childAmount === 'number') childAmount += serviceCharge / Math.max(1, input.adults + input.children);
    }
    if (type === 'event' && data.ticketTypes?.length) {
      const ticket = data.ticketTypes.find((item: any) => this.key(item.type) === input.optionId) ?? data.ticketTypes.find((item: any) => item.price);
      if (!ticket || ticket.availableQuantity === 0 || (ticket.salesEndAt && new Date(ticket.salesEndAt) <= new Date())) {
        throw appError(409, 'PACKAGE_UNAVAILABLE', 'This ticket is currently unavailable');
      }
      optionName = ticket.type;
      amount = ticket.price?.amount ?? amount;
      refundable = Boolean(ticket.refundable);
      const sessions = (data.sessions ?? []).map((value: any) => String(value.startsAt).slice(0, 10));
      if (sessions.length && !sessions.includes(input.date)) throw appError(409, 'DATE_UNAVAILABLE', 'This event session is unavailable');
    }
    if (typeof amount !== 'number' || amount < 0) throw appError(409, 'PRICE_UNAVAILABLE', 'This package does not have a bookable price');

    const currency = data.adultPrice?.currency || data.startingPrice?.currency || data.price?.currency || 'AED';
    const unit = { amount, currency };
    const childUnit = { amount: childAmount ?? amount, currency };
    const { lines, subtotalMinor } = priceTravellers({ adultPrice: unit, childPrice: childUnit, adults: input.adults, children: input.children });
    const location = type === 'visa' ? data.country : data.city;
    return {
      activity: { slug, title: data.title, image: data.coverImage || data.images?.[0]?.url || '', ...(location && { locationName: location }) },
      option: {
        id: input.optionId || 'standard', name: optionName, transferType: 'none', adultPrice: unit, childPrice: childUnit,
        minPax: 1, maxPax: 50, pickupRequired: false, refundable, operatingWeekdays: [0, 1, 2, 3, 4, 5, 6], blackoutDates: [],
      } as any,
      lines,
      subtotalMinor,
    };
  }

  async available(type: PackageType, slug: string, input: { optionId: string; date: string; adults: number; children: number }): Promise<{ available: boolean; remaining?: number }> {
    try { await this.prepare(type, slug, input); return { available: true }; }
    catch { return { available: false }; }
  }

  private key(value: string) {
    return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'standard';
  }
}
