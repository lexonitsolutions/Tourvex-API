import { Injectable } from '@nestjs/common';
import { appError } from '../common/app-error';
import { CruisesService } from '../cruises/cruises.service';
import { EventsService } from '../events/events.service';
import { HolidaysService } from '../holidays/holidays.service';
import { priceTravellers } from './checkout-pricing';
import type { PreparedItem } from '../catalog/catalog.service';

export type PackageType = 'holiday' | 'cruise' | 'event';

/** Resolves non-activity cart lines from live catalogue data. The browser never supplies a trusted price. */
@Injectable()
export class PackageCartService {
  constructor(
    private readonly holidays: HolidaysService,
    private readonly cruises: CruisesService,
    private readonly events: EventsService,
  ) {}

  async prepare(type: PackageType, slug: string, input: { optionId: string; date: string; adults: number; children: number }): Promise<PreparedItem> {
    const data: any = type === 'holiday'
      ? (await this.holidays.findBySlug(slug)).package
      : type === 'cruise'
        ? (await this.cruises.findBySlug(slug)).cruise
        : (await this.events.findBySlug(slug)).event;

    if (!data.allowAddToCart) throw appError(409, 'CART_DISABLED', 'Add to Cart is not available for this package');
    if (data.stock?.soldOut) throw appError(409, 'PACKAGE_UNAVAILABLE', 'This package is currently unavailable');

    let optionName = 'Standard package';
    let amount = data.salePrice?.amount ?? data.price?.amount;
    let refundable = false;
    if (type === 'cruise' && data.cabins?.length) {
      const cabin = data.cabins.find((item: any) => this.key(item.type) === input.optionId) ?? data.cabins.find((item: any) => item.fromPrice);
      if (!cabin) throw appError(409, 'PACKAGE_UNAVAILABLE', 'This cruise has no bookable cabin');
      optionName = cabin.type;
      amount = cabin.fromPrice?.amount ?? amount;
      const departures = (data.departures ?? []).map((value: string) => value.slice(0, 10));
      if (departures.length && !departures.includes(input.date)) throw appError(409, 'DATE_UNAVAILABLE', 'This cruise departure is unavailable');
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

    const unit = { amount, currency: 'AED' };
    const { lines, subtotalMinor } = priceTravellers({ adultPrice: unit, childPrice: unit, adults: input.adults, children: input.children });
    const location = type === 'holiday' ? data.destinations?.[0] || data.country : type === 'cruise' ? data.departureCity : data.city;
    return {
      activity: { slug, title: data.title, image: data.coverImage || data.images?.[0]?.url || '', ...(location && { locationName: location }) },
      option: {
        id: input.optionId || 'standard', name: optionName, transferType: 'none', adultPrice: unit, childPrice: unit,
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
