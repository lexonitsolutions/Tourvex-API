import { shouldExposeSamples } from '../holidays/holidays.utils';

export { shouldExposeSamples };

export const PARTNER_PLACEMENTS = ['home', 'activities'] as const;
export type PartnerPlacement = (typeof PARTNER_PLACEMENTS)[number];

export const PARTNERS_TITLE = 'In Partnership with World-Class Attractions';
export const PARTNERS_SUBTITLE = 'Trusted attractions and experiences, handpicked for your trip.';

/** Site asset, uploaded media asset, or secure remote URL. */
export const LOGO_PATTERN = /^(\/(?:images|api\/v1\/media\/images)\/\S+|https:\/\/\S+)$/;
/** `https://...` only (no javascript:, data:, http: ...). */
export const HREF_PATTERN = /^https:\/\/\S+$/;

export function buildPartnerFilter(
  placement: PartnerPlacement | undefined,
  showSamples: boolean,
): Record<string, unknown> {
  const filter: Record<string, unknown> = showSamples
    ? { published: true }
    : { published: true, isSample: { $ne: true } };
  if (placement) filter.placements = placement;
  return filter;
}
