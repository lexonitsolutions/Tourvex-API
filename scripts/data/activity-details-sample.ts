/**
 * ORIGINAL SAMPLE detail content for the activity pages. Nothing here is copied from any website and
 * nothing is a verified fact about a real operator: every activity is flagged `detailsAreSample: true`
 * (hidden in production unless ACTIVITY_SAMPLE_DETAILS=true). There are no reviews or ratings.
 *
 * Option prices are derived at seed time from the activity's own listed price (`priceFactor` x the
 * sale price or price), so the sample never invents a price list. Replace with supplier-verified data
 * (admin PATCH /catalog/activities/:id/details or `npm run seed:activity-details -- --file x.json`).
 */

export interface SampleOption {
  id: string;
  name: string;
  transferType: 'sharing' | 'private' | 'none';
  startTime?: string;
  durationLabel?: string;
  /** Multiplier on the activity's listed price. */
  priceFactor: number;
  /** Child price as a share of the adult price; omit when children are not accepted. */
  childRatio?: number;
  childAgeRange?: string;
  minPax: number;
  maxPax: number;
  pickupRequired: boolean;
  refundable: boolean;
  freeCancellationHours?: number;
  operatingWeekdays: number[];
  /** Adds one blackout date (the 15th of next month, computed when the seed runs). */
  withBlackout?: boolean;
  dailyCapacity?: number;
  cutoffHours?: number;
}

export interface SampleActivityDetails {
  slug: string;
  operatingHours: string;
  instantConfirmation: boolean;
  mobileVoucher: boolean;
  freeCancellationHours?: number;
  languages: string[];
  description: string;
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  howToRedeem: string[];
  importantInfo: string[];
  whatToBring?: string[];
  cancellationPolicy?: string[];
  itinerary?: Array<{ title: string; duration?: string; description: string; imageUrl?: string }>;
  faqs?: Array<{ question: string; answer: string }>;
  contentSections?: Array<{ title: string; body?: string; items?: string[] }>;
  duration: string;
  locationName: string;
  locationAddress: string;
  options: SampleOption[];
}

const SAMPLE_NOTICE =
  'Sample content for development: replace with verified supplier information before launch.';
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS_AND_SAT = [1, 2, 3, 4, 5, 6];
const MID_WEEK_TO_SUN = [3, 4, 5, 6, 0];

export const SAMPLE_ACTIVITY_DETAILS: SampleActivityDetails[] = [
  {
    slug: 'burj-khalifa-at-the-top-activities',
    operatingHours: 'Sample: daytime and evening slots',
    instantConfirmation: true,
    mobileVoucher: true,
    freeCancellationHours: 24,
    languages: ['English', 'Arabic'],
    description:
      'A skyline viewing visit built around a timed entry slot. Arrive a little early, pass through the security check, and spend your time at the viewing level at your own pace.\n\nPick the daytime slot for clear distance views or the later slot for the city lights. Both are sample options to demonstrate how options, dates and prices work together.',
    highlights: ['Timed entry to the viewing level', 'Choose a daytime or later slot', 'Mobile voucher, no printing'],
    inclusions: ['Entry for the chosen time slot', 'Access to the viewing level'],
    exclusions: ['Hotel transfers', 'Food and drinks', 'Photos taken by third parties'],
    howToRedeem: [
      'Open the mobile voucher from your booking page.',
      'Arrive 15 minutes before your slot.',
      'Show the QR code at the entrance.',
    ],
    importantInfo: [SAMPLE_NOTICE, 'Bring a photo ID; entry may be refused without it.'],
    whatToBring: ['A charged phone with your mobile voucher', 'A valid photo ID', 'Comfortable footwear'],
    cancellationPolicy: [
      'Cancel at least 24 hours before the selected time for a full refund on refundable options.',
      'Late arrivals and no-shows are not refundable.',
    ],
    itinerary: [
      { title: 'Arrival and check-in', duration: '15 minutes', description: 'Present your mobile voucher and photo ID, then complete the entrance security check.' },
      { title: 'Welcome experience', duration: '20 minutes', description: 'Follow the introductory route before continuing to the main viewing level.' },
      { title: 'Explore the observation level', duration: '60-90 minutes', description: 'Enjoy the skyline viewpoints at your own pace and use the available interpretation displays.' },
    ],
    faqs: [
      { question: 'How early should I arrive?', answer: 'Plan to arrive at least 15 minutes before the time printed on your voucher.' },
      { question: 'Can I show the voucher on my phone?', answer: 'Yes. A mobile voucher is accepted, so printing is not required.' },
    ],
    contentSections: [
      { title: 'Before you visit', body: 'A little preparation makes the experience smoother.', items: ['Check the selected date and time on every voucher.', 'Allow extra travel time during busy periods.', 'Keep all guests together during check-in.'] },
    ],
    duration: 'Approx 1 to 2 hours',
    locationName: 'Downtown Dubai (sample)',
    locationAddress: 'Dubai, United Arab Emirates',
    options: [
      {
        id: 'standard-entry',
        name: 'Standard entry',
        transferType: 'none',
        startTime: '10:00',
        durationLabel: '1-2 hours',
        priceFactor: 1,
        childRatio: 0.75,
        childAgeRange: '4-12 years',
        minPax: 1,
        maxPax: 10,
        pickupRequired: false,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: EVERY_DAY,
        withBlackout: true,
        dailyCapacity: 120,
        cutoffHours: 2,
      },
      {
        id: 'evening-entry',
        name: 'Evening entry (non-refundable)',
        transferType: 'none',
        startTime: '18:00',
        durationLabel: '1-2 hours',
        priceFactor: 1.35,
        childRatio: 0.75,
        childAgeRange: '4-12 years',
        minPax: 1,
        maxPax: 10,
        pickupRequired: false,
        refundable: false,
        operatingWeekdays: EVERY_DAY,
        dailyCapacity: 80,
        cutoffHours: 2,
      },
    ],
  },
  {
    slug: 'dubai-aquarium-and-underwater-zoo-tickets',
    operatingHours: 'Sample: open daily, last entry shown on the voucher',
    instantConfirmation: true,
    mobileVoucher: true,
    freeCancellationHours: 24,
    languages: ['English', 'Arabic'],
    description:
      'A family-friendly indoor visit with a flexible arrival window. Walk through the exhibits at your own speed and take breaks whenever you like.\n\nThe sample options show a plain entry ticket and a non-refundable bundle with extras, so you can try both refundable and non-refundable flows.',
    highlights: ['Indoor, weather-proof visit', 'Flexible arrival on the chosen day', 'Child pricing available'],
    inclusions: ['Entry on the chosen date'],
    exclusions: ['Transfers', 'Meals', 'Optional extras unless the option says so'],
    howToRedeem: ['Show the mobile voucher at the ticket gate.', 'Keep your phone charged for scanning.'],
    importantInfo: [SAMPLE_NOTICE, 'Children must stay with an adult.'],
    duration: 'Approx 2 to 3 hours',
    locationName: 'Dubai (sample)',
    locationAddress: 'Dubai, United Arab Emirates',
    options: [
      {
        id: 'general-admission',
        name: 'General admission',
        transferType: 'none',
        durationLabel: '2-3 hours',
        priceFactor: 1,
        childRatio: 0.8,
        childAgeRange: '3-11 years',
        minPax: 1,
        maxPax: 12,
        pickupRequired: false,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: EVERY_DAY,
        dailyCapacity: 200,
        cutoffHours: 1,
      },
      {
        id: 'admission-with-extras',
        name: 'Admission with extras (non-refundable)',
        transferType: 'none',
        durationLabel: '3-4 hours',
        priceFactor: 1.4,
        childRatio: 0.8,
        childAgeRange: '3-11 years',
        minPax: 1,
        maxPax: 12,
        pickupRequired: false,
        refundable: false,
        operatingWeekdays: WEEKDAYS_AND_SAT,
        cutoffHours: 4,
      },
    ],
  },
  {
    slug: 'museum-of-the-future',
    operatingHours: 'Sample: timed entry slots',
    instantConfirmation: true,
    mobileVoucher: true,
    freeCancellationHours: 48,
    languages: ['English', 'Arabic'],
    description:
      'A timed-entry museum visit designed to be explored at a relaxed pace. Choose a start time, arrive a few minutes early and enjoy the exhibits on your own.\n\nThis sample listing has a single refundable option with a daily limit, which is handy for testing capacity and cut-off rules.',
    highlights: ['Timed entry', 'Refundable up to 48 hours before', 'Mobile voucher'],
    inclusions: ['Entry for the chosen slot'],
    exclusions: ['Transfers', 'Guided commentary unless stated', 'Food and drinks'],
    howToRedeem: ['Open your mobile voucher.', 'Arrive at least 10 minutes before the slot.', 'Scan the code at the gate.'],
    importantInfo: [SAMPLE_NOTICE, 'Late arrivals may be moved to the next available slot.'],
    duration: 'Approx 2 hours',
    locationName: 'Dubai (sample)',
    locationAddress: 'Dubai, United Arab Emirates',
    options: [
      {
        id: 'timed-entry',
        name: 'Timed entry',
        transferType: 'none',
        startTime: '11:00',
        durationLabel: '2 hours',
        priceFactor: 1,
        childRatio: 0.7,
        childAgeRange: '3-12 years',
        minPax: 1,
        maxPax: 8,
        pickupRequired: false,
        refundable: true,
        freeCancellationHours: 48,
        operatingWeekdays: EVERY_DAY,
        dailyCapacity: 150,
        cutoffHours: 3,
      },
    ],
  },
  {
    slug: 'dubai-frame',
    operatingHours: 'Sample: daily visiting hours',
    instantConfirmation: true,
    mobileVoucher: true,
    freeCancellationHours: 24,
    languages: ['English'],
    description:
      'A short, easy city visit that fits between other plans. Pick a date, show your voucher and take your time at the top.\n\nThis sample listing uses a single refundable option with no start time, so same-day booking works until the end of the day.',
    highlights: ['Quick visit', 'No fixed start time', 'Easy to combine with other activities'],
    inclusions: ['Entry on the chosen date'],
    exclusions: ['Transfers', 'Food and drinks'],
    howToRedeem: ['Show the mobile voucher at the entrance.'],
    importantInfo: [SAMPLE_NOTICE],
    duration: 'Approx 1 hour',
    locationName: 'Dubai (sample)',
    locationAddress: 'Dubai, United Arab Emirates',
    options: [
      {
        id: 'standard-entry',
        name: 'Standard entry',
        transferType: 'none',
        durationLabel: '1 hour',
        priceFactor: 1,
        childRatio: 0.75,
        childAgeRange: '3-12 years',
        minPax: 1,
        maxPax: 15,
        pickupRequired: false,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: EVERY_DAY,
        dailyCapacity: 300,
        cutoffHours: 0,
      },
    ],
  },
  {
    slug: 'big-bus-tour-dubai',
    operatingHours: 'Sample: morning to late afternoon',
    instantConfirmation: true,
    mobileVoucher: true,
    freeCancellationHours: 24,
    languages: ['English', 'Arabic'],
    description:
      'A sightseeing tour for visitors who like to see several areas in one day. Choose the classic route and start at the boarding point, or add a hotel pick-up in the sample pick-up option.\n\nThe two sample options illustrate how the pick-up step appears only when an option needs it.',
    highlights: ['Several city areas in one tour', 'Optional hotel pick-up', 'Flexible day plan'],
    inclusions: ['Tour ticket for the chosen date', 'Pick-up and drop-off in the pick-up option'],
    exclusions: ['Entry fees to attractions', 'Meals'],
    howToRedeem: ['Open the mobile voucher.', 'Show it to the guide at the boarding point.', 'For pick-up, be at your hotel lobby 10 minutes early.'],
    importantInfo: [SAMPLE_NOTICE, 'Tell us your hotel when booking the pick-up option.'],
    duration: 'Flexible, up to a full day',
    locationName: 'Dubai (sample)',
    locationAddress: 'Dubai, United Arab Emirates',
    options: [
      {
        id: 'classic-route',
        name: 'Classic route, meet at boarding point',
        transferType: 'none',
        startTime: '09:30',
        durationLabel: 'Flexible',
        priceFactor: 1,
        childRatio: 0.7,
        childAgeRange: '4-15 years',
        minPax: 1,
        maxPax: 20,
        pickupRequired: false,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: EVERY_DAY,
        cutoffHours: 2,
      },
      {
        id: 'route-with-pickup',
        name: 'Route with hotel pick-up',
        transferType: 'sharing',
        startTime: '08:30',
        durationLabel: 'Flexible',
        priceFactor: 1.25,
        childRatio: 0.7,
        childAgeRange: '4-15 years',
        minPax: 2,
        maxPax: 20,
        pickupRequired: true,
        refundable: false,
        operatingWeekdays: WEEKDAYS_AND_SAT,
        dailyCapacity: 60,
        cutoffHours: 12,
      },
    ],
  },
  {
    slug: 'dhow-cruise-dubai-marina',
    operatingHours: 'Sample: evening departures',
    instantConfirmation: false,
    mobileVoucher: true,
    freeCancellationHours: 24,
    languages: ['English', 'Arabic', 'Hindi'],
    description:
      'An evening cruise along the waterfront with a relaxed pace and a set departure time. Choose shared seating or a private option and tell us where to collect you.\n\nThe sample options cover a refundable shared cruise and a non-refundable private one with limited operating days.',
    highlights: ['Evening departure', 'Hotel pick-up available', 'Shared or private option'],
    inclusions: ['Cruise on the chosen date', 'Pick-up and drop-off from the pick-up location'],
    exclusions: ['Extra drinks', 'Gratuities'],
    howToRedeem: ['Share your pick-up location at checkout.', 'Be ready 10 minutes before the pick-up time.', 'Show the mobile voucher on boarding.'],
    importantInfo: [SAMPLE_NOTICE, 'Cruises may be rescheduled for safety reasons.'],
    duration: 'Approx 2 hours',
    locationName: 'Dubai Marina (sample)',
    locationAddress: 'Dubai, United Arab Emirates',
    options: [
      {
        id: 'shared-cruise',
        name: 'Shared cruise with pick-up',
        transferType: 'sharing',
        startTime: '19:00',
        durationLabel: '2 hours',
        priceFactor: 1,
        childRatio: 0.7,
        childAgeRange: '3-11 years',
        minPax: 1,
        maxPax: 10,
        pickupRequired: true,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: EVERY_DAY,
        withBlackout: true,
        dailyCapacity: 80,
        cutoffHours: 6,
      },
      {
        id: 'private-cruise',
        name: 'Private cruise (non-refundable)',
        transferType: 'private',
        startTime: '19:30',
        durationLabel: '2 hours',
        priceFactor: 2.2,
        minPax: 2,
        maxPax: 6,
        pickupRequired: true,
        refundable: false,
        operatingWeekdays: MID_WEEK_TO_SUN,
        dailyCapacity: 12,
        cutoffHours: 24,
      },
    ],
  },
  {
    slug: 'desert-safari-ras-al-khaimah',
    operatingHours: 'Sample: afternoon to late evening',
    instantConfirmation: false,
    mobileVoucher: true,
    freeCancellationHours: 24,
    languages: ['English', 'Arabic'],
    description:
      'An afternoon-to-evening desert outing with transfers from your hotel. Expect a mix of dune time, a relaxed camp and an evening meal on the sample itinerary.\n\nBook the shared transfer for the best value or the private option when you want your own vehicle. Pick-up details are collected at checkout.',
    highlights: ['Transfers included', 'Evening at a desert camp', 'Shared or private vehicle'],
    inclusions: ['Round-trip transfer', 'Camp visit', 'Evening meal and soft drinks'],
    exclusions: ['Optional activities at the camp', 'Gratuities'],
    howToRedeem: ['Enter your pick-up location at checkout.', 'The team confirms the pick-up time the day before.', 'Show the mobile voucher to the driver.'],
    importantInfo: [SAMPLE_NOTICE, 'Not recommended during pregnancy or for guests with back problems.'],
    duration: 'Approx 6 hours',
    locationName: 'Ras Al Khaimah (sample)',
    locationAddress: 'Ras Al Khaimah, United Arab Emirates',
    options: [
      {
        id: 'shared-transfer',
        name: 'Evening experience, shared transfer',
        transferType: 'sharing',
        startTime: '15:30',
        durationLabel: '6 hours',
        priceFactor: 1,
        childRatio: 0.8,
        childAgeRange: '3-11 years',
        minPax: 1,
        maxPax: 12,
        pickupRequired: true,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: EVERY_DAY,
        dailyCapacity: 100,
        cutoffHours: 12,
      },
      {
        id: 'private-transfer',
        name: 'Evening experience, private transfer (non-refundable)',
        transferType: 'private',
        startTime: '15:00',
        durationLabel: '6 hours',
        priceFactor: 1.8,
        childRatio: 0.8,
        childAgeRange: '3-11 years',
        minPax: 2,
        maxPax: 6,
        pickupRequired: true,
        refundable: false,
        operatingWeekdays: EVERY_DAY,
        dailyCapacity: 20,
        cutoffHours: 24,
      },
      {
        id: 'self-drive-to-camp',
        name: 'Camp evening, no transfer',
        transferType: 'none',
        startTime: '17:00',
        durationLabel: '4 hours',
        priceFactor: 0.8,
        childRatio: 0.8,
        childAgeRange: '3-11 years',
        minPax: 1,
        maxPax: 12,
        pickupRequired: false,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: MID_WEEK_TO_SUN,
        cutoffHours: 6,
      },
    ],
  },
  {
    slug: 'madame-tussauds-dubai',
    operatingHours: 'Sample: daily visiting hours',
    instantConfirmation: true,
    mobileVoucher: true,
    freeCancellationHours: 24,
    languages: ['English', 'Arabic'],
    description:
      'An indoor attraction visit with a flexible arrival time on the day you choose. Move through the galleries at your own pace and plan photo stops as you go.\n\nThis sample listing has one refundable ticket so you can test the simplest booking path from detail page to confirmation.',
    highlights: ['Indoor visit', 'Flexible arrival on the day', 'Child tickets available'],
    inclusions: ['Entry on the chosen date'],
    exclusions: ['Transfers', 'Food and drinks', 'Souvenir photos'],
    howToRedeem: ['Show the mobile voucher at the entrance.'],
    importantInfo: [SAMPLE_NOTICE, 'Large bags may need to be left at the cloakroom.'],
    duration: 'Approx 2 hours',
    locationName: 'Dubai (sample)',
    locationAddress: 'Dubai, United Arab Emirates',
    options: [
      {
        id: 'entry-ticket',
        name: 'Entry ticket',
        transferType: 'none',
        durationLabel: '2 hours',
        priceFactor: 1,
        childRatio: 0.8,
        childAgeRange: '4-15 years',
        minPax: 1,
        maxPax: 12,
        pickupRequired: false,
        refundable: true,
        freeCancellationHours: 24,
        operatingWeekdays: EVERY_DAY,
        cutoffHours: 1,
      },
    ],
  },
];

export interface SamplePromo {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotal?: number;
  maxDiscount?: number;
  usageLimit?: number;
  description: string;
}

export const SAMPLE_PROMOS: SamplePromo[] = [
  {
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    maxDiscount: 100,
    description: 'Sample: 10% off, capped at AED 100',
  },
  {
    code: 'SAVE50',
    type: 'fixed',
    value: 50,
    minSubtotal: 400,
    description: 'Sample: AED 50 off carts of AED 400 or more',
  },
];
