/**
 * Original sample content for the Visas feature. Every visa is flagged `isSample: true` and is
 * hidden from public endpoints in production unless VISAS_ALLOW_SAMPLES=true.
 *
 * The wording is deliberately generic and cautious: it makes no claims about government fees,
 * exact legal rules or guaranteed outcomes. Prices are an INDICATIVE AED service fee ("from"),
 * not a government fee. Verify every product with real, current information before launch.
 */

type Kind = 'evisa' | 'embassy';

export interface SampleVisa {
  slug: string;
  country: string;
  countryCode: string;
  title: string;
  kind: Kind;
  summary: string;
  description: string;
  startingPrice: { amount: number; currency: string };
  processing: string;
  validity: string;
  entries: 'single' | 'multiple' | 'varies';
  stay: string;
  highlights: string[];
  requirements: string[];
  documents: string[];
  steps: { title: string; description: string }[];
  faqs: { question: string; answer: string }[];
  notes: string;
  sections: string[];
  popularity: number;
  published: boolean;
  isSample: boolean;
}

export interface SampleSection {
  slug: string;
  title: string;
  subtitle: string;
  order: number;
  published: boolean;
}

export interface SampleBanner {
  eyebrow: string;
  title: string;
  subtitle: string;
  description: string;
  countryCode: string;
  ctaLabel: string;
  ctaHref: string;
  order: number;
  published: boolean;
}

interface Spec {
  slug: string;
  country: string;
  code: string;
  title: string;
  kind: Kind;
  price: number;
  processing: string;
  entries: 'single' | 'multiple' | 'varies';
  /** Two country-specific highlights; generic ones are appended. */
  highlights: [string, string];
  /** Optional extra detail woven into the second description paragraph. */
  tip: string;
}

const NOTES =
  'Requirements, fees and processing times shown here are indicative and are confirmed when you enquire.';

const EVISA_PROCESSING = ['Typically 1-3 working days', 'Typically 3-5 working days', 'Typically 5-7 working days'];

function build(spec: Spec, popularity: number): SampleVisa {
  const online = spec.kind === 'evisa';
  const { country } = spec;
  return {
    slug: spec.slug,
    country,
    countryCode: spec.code,
    title: spec.title,
    kind: spec.kind,
    summary: online
      ? `Apply online for a ${country} visa with our team checking your details before submission.`
      : `Plan ahead for a ${country} visa processed through the embassy or consulate, with guidance at each step.`,
    description: online
      ? `Many travellers can apply for a ${country} visa online, without visiting an office in person. ` +
        `You share your travel details and documents with us, we check them for completeness, and the application is submitted on your behalf.` +
        `\n\n` +
        `Eligibility and the type of visa available depend on your nationality, residence status and the purpose of your trip. ${spec.tip} ` +
        `Tell us about your plans through the enquiry form and our team will confirm what applies to you, along with the current fee and timing.`
      : `A visa for ${country} is usually arranged through the embassy, consulate or an authorised visa centre, which means more paperwork and a longer wait than an online application. ` +
        `Our team helps you prepare the documents, book any required appointment and follow the process.` +
        `\n\n` +
        `Requirements differ by nationality, residence status and the purpose of your trip, and they can change. ${spec.tip} ` +
        `Tell us about your plans through the enquiry form and we will confirm what applies to you, along with the current fees and expected timing.`,
    startingPrice: { amount: spec.price, currency: 'AED' },
    processing: spec.processing,
    validity: online ? 'Varies by visa type' : 'Set by the issuing authority',
    entries: spec.entries,
    stay: online ? 'Depends on the visa type granted' : 'Set by the issuing authority',
    highlights: [
      ...spec.highlights,
      online ? 'Apply online, with no queue at an office' : 'Guidance on the documents and appointment steps',
      'Our team checks your documents before submission',
    ],
    requirements: [
      `Eligibility for ${country} depends on your nationality and residence status.`,
      'A passport that stays valid for the period the destination requires, often several months beyond your trip.',
      'A clear purpose of travel, such as tourism, family visit or business.',
      'Travel dates and a planned itinerary or accommodation details.',
      online
        ? 'An email address you can access, because updates are usually sent by email.'
        : 'Availability to attend an appointment or biometric visit if the authority asks for one.',
    ],
    documents: [
      'A clear scan or photo of your passport information page',
      'A recent passport-style photograph',
      'Flight or itinerary details, where requested',
      'Accommodation details or an invitation, where requested',
      'A copy of your UAE residence permit, if you live in the UAE',
      ...(online ? [] : ['Any additional forms or supporting letters the authority asks for']),
    ],
    steps: [
      {
        title: 'Apply online',
        description: 'Send us your travel details through the enquiry form so we can confirm the right visa for you.',
      },
      {
        title: 'Submit your documents',
        description: 'Share the documents we list for your case. We check them for completeness before anything is sent.',
      },
      {
        title: 'Review',
        description: online
          ? 'The application is submitted and reviewed by the issuing authority. We keep you updated on any questions.'
          : 'The embassy, consulate or visa centre reviews the application. We keep you updated on any questions.',
      },
      {
        title: 'Receive your visa decision',
        description: online
          ? 'You receive the outcome by email or through our team, and we explain what to carry when you travel.'
          : 'You receive your passport or the decision as arranged, and we explain what to carry when you travel.',
      },
    ],
    faqs: [
      {
        question: `Do I need a visa for ${country}?`,
        answer:
          'It depends on your nationality, residence status and reason for travel. Send an enquiry and we will confirm what applies to you.',
      },
      {
        question: 'How long will it take?',
        answer:
          'Timing varies with the season, the authority and your documents. The label shown is indicative and is confirmed when you enquire.',
      },
      {
        question: 'What does the starting price cover?',
        answer:
          'It is our indicative service fee. Government or embassy charges, if any, are separate and are confirmed when you enquire.',
      },
      {
        question: 'Is approval guaranteed?',
        answer:
          'No. The decision is always made by the issuing authority, so we cannot promise an outcome. We help you submit a complete application.',
      },
    ],
    notes: NOTES,
    sections: [spec.kind],
    popularity,
    published: true,
    isSample: true,
  };
}

const EVISA_SPECS: Spec[] = [
  {
    slug: 'uae-evisa', country: 'United Arab Emirates', code: 'ae', title: 'UAE e-Visa', kind: 'evisa', price: 249,
    processing: EVISA_PROCESSING[1], entries: 'varies',
    highlights: ['A starting point for trips to Dubai, Abu Dhabi and the other emirates', 'Useful for visitors travelling in for leisure or events'],
    tip: 'Visitors often combine a stay in one emirate with day trips to another, so mention your plans.',
  },
  {
    slug: 'saudi-arabia-evisa', country: 'Saudi Arabia', code: 'sa', title: 'Saudi Arabia e-Visa', kind: 'evisa', price: 279,
    processing: EVISA_PROCESSING[1], entries: 'varies',
    highlights: ['Support for leisure and visit travel plans', 'Help understanding which visa category suits your trip'],
    tip: 'Rules can differ between leisure travel and pilgrimage travel, so tell us the purpose of your trip.',
  },
  {
    slug: 'vietnam-evisa', country: 'Vietnam', code: 'vn', title: 'Vietnam e-Visa', kind: 'evisa', price: 199,
    processing: EVISA_PROCESSING[1], entries: 'single',
    highlights: ['An online route for many tourist trips', 'Helpful for multi-city itineraries across the country'],
    tip: 'Share your planned entry and exit points so we can check them against your application.',
  },
  {
    slug: 'oman-evisa', country: 'Oman', code: 'om', title: 'Oman e-Visa', kind: 'evisa', price: 189,
    processing: EVISA_PROCESSING[0], entries: 'varies',
    highlights: ['A convenient option for short breaks from the Gulf', 'Support for both road and air arrivals'],
    tip: 'Travellers who plan to drive across a land border should mention it when they enquire.',
  },
  {
    slug: 'india-evisa', country: 'India', code: 'in', title: 'India e-Visa', kind: 'evisa', price: 229,
    processing: EVISA_PROCESSING[2], entries: 'varies',
    highlights: ['Online application for several travel purposes', 'Guidance on photo and passport scan formats'],
    tip: 'Image and document formats are checked closely, so we review each file before it is sent.',
  },
  {
    slug: 'indonesia-evisa', country: 'Indonesia', code: 'id', title: 'Indonesia e-Visa', kind: 'evisa', price: 219,
    processing: EVISA_PROCESSING[1], entries: 'single',
    highlights: ['Helpful for island-hopping trips such as Bali and beyond', 'Support for tourism and short visits'],
    tip: 'If you plan to visit several islands, share your route so we can note it in your enquiry.',
  },
  {
    slug: 'turkiye-evisa', country: 'Türkiye', code: 'tr', title: 'Türkiye e-Visa', kind: 'evisa', price: 179,
    processing: EVISA_PROCESSING[0], entries: 'varies',
    highlights: ['Online application for trips to Istanbul, Cappadocia and the coast', 'Support for tourism and short city breaks'],
    tip: 'Some nationalities may not need a visa at all, which is one of the first things we check.',
  },
  {
    slug: 'thailand-evisa', country: 'Thailand', code: 'th', title: 'Thailand e-Visa', kind: 'evisa', price: 209,
    processing: EVISA_PROCESSING[1], entries: 'varies',
    highlights: ['Support for beach, city and island itineraries', 'Guidance on documents for longer stays'],
    tip: 'Length of stay and entry rules can differ by nationality, so we confirm them before you apply.',
  },
  {
    slug: 'singapore-evisa', country: 'Singapore', code: 'sg', title: 'Singapore e-Visa', kind: 'evisa', price: 239,
    processing: EVISA_PROCESSING[1], entries: 'varies',
    highlights: ['A good fit for city breaks and stopovers', 'Help with the arrival information many travellers must provide'],
    tip: 'Stopover travellers should share their onward ticket details when they enquire.',
  },
  {
    slug: 'malaysia-evisa', country: 'Malaysia', code: 'my', title: 'Malaysia e-Visa', kind: 'evisa', price: 189,
    processing: EVISA_PROCESSING[1], entries: 'varies',
    highlights: ['Online route for trips to Kuala Lumpur and beyond', 'Support for combined Malaysia and region itineraries'],
    tip: 'Some nationalities may travel without a visa for short visits, so we check this first.',
  },
  {
    slug: 'azerbaijan-evisa', country: 'Azerbaijan', code: 'az', title: 'Azerbaijan e-Visa', kind: 'evisa', price: 169,
    processing: EVISA_PROCESSING[0], entries: 'single',
    highlights: ['A quick online option for city and mountain trips', 'Well suited to short breaks from the Gulf'],
    tip: 'Share your arrival date early, since many travellers apply close to their departure.',
  },
  {
    slug: 'kenya-evisa', country: 'Kenya', code: 'ke', title: 'Kenya e-Visa', kind: 'evisa', price: 219,
    processing: EVISA_PROCESSING[1], entries: 'single',
    highlights: ['Support for safari and coastal itineraries', 'Guidance on the travel authorisation steps'],
    tip: 'Safari travellers often cross into neighbouring countries, so mention any onward plans.',
  },
  {
    slug: 'egypt-evisa', country: 'Egypt', code: 'eg', title: 'Egypt e-Visa', kind: 'evisa', price: 199,
    processing: EVISA_PROCESSING[1], entries: 'varies',
    highlights: ['Online application for Cairo, Luxor and the Red Sea', 'Support for tours and independent travel'],
    tip: 'Some arrivals may receive a visa on entry instead, so we explain which route fits you.',
  },
  {
    slug: 'japan-evisa', country: 'Japan', code: 'jp', title: 'Japan e-Visa', kind: 'evisa', price: 269,
    processing: EVISA_PROCESSING[2], entries: 'single',
    highlights: ['Guidance for short tourist visits', 'Help organising a clear day-by-day itinerary'],
    tip: 'A detailed itinerary is often requested, so it helps to prepare your plan in advance.',
  },
  {
    slug: 'sri-lanka-evisa', country: 'Sri Lanka', code: 'lk', title: 'Sri Lanka e-Visa', kind: 'evisa', price: 179,
    processing: EVISA_PROCESSING[0], entries: 'varies',
    highlights: ['Online option for beach, tea-country and cultural trips', 'Support for family and group travel'],
    tip: 'Families travelling together can enquire in one request by listing the number of travellers.',
  },
  {
    slug: 'bahrain-evisa', country: 'Bahrain', code: 'bh', title: 'Bahrain e-Visa', kind: 'evisa', price: 159,
    processing: EVISA_PROCESSING[0], entries: 'varies',
    highlights: ['A simple option for weekend trips', 'Helpful for road and air arrivals'],
    tip: 'Residents of some countries may have different rules, so share your residence status.',
  },
  {
    slug: 'kuwait-evisa', country: 'Kuwait', code: 'kw', title: 'Kuwait e-Visa', kind: 'evisa', price: 169,
    processing: EVISA_PROCESSING[1], entries: 'varies',
    highlights: ['Support for short visits and family travel', 'Help understanding the right visa category'],
    tip: 'Visit and business categories can differ, so tell us why you are travelling.',
  },
  {
    slug: 'uzbekistan-evisa', country: 'Uzbekistan', code: 'uz', title: 'Uzbekistan e-Visa', kind: 'evisa', price: 179,
    processing: EVISA_PROCESSING[0], entries: 'single',
    highlights: ['Online application for Silk Road city itineraries', 'Suitable for short cultural tours'],
    tip: 'Many travellers visit more than one city, so share your planned route when you enquire.',
  },
  {
    slug: 'armenia-evisa', country: 'Armenia', code: 'am', title: 'Armenia e-Visa', kind: 'evisa', price: 159,
    processing: EVISA_PROCESSING[0], entries: 'single',
    highlights: ['A quick option for short breaks', 'Well suited to combining with nearby countries'],
    tip: 'Some nationalities may not need a visa for short stays, which we check as a first step.',
  },
  {
    slug: 'south-africa-evisa', country: 'South Africa', code: 'za', title: 'South Africa e-Visa', kind: 'evisa', price: 259,
    processing: EVISA_PROCESSING[2], entries: 'varies',
    highlights: ['Support for city, coast and safari itineraries', 'Guidance on documents for family travel'],
    tip: 'Travelling with children can involve extra paperwork, so tell us who is travelling.',
  },
];

const EMBASSY_SPECS: Spec[] = [
  {
    slug: 'united-states-visa', country: 'United States', code: 'us', title: 'United States Visa', kind: 'embassy', price: 549,
    processing: 'Typically several weeks, plus any interview wait', entries: 'varies',
    highlights: ['Help preparing the online form and documents', 'Guidance on booking appointments'],
    tip: 'An interview is commonly part of the process, and appointment availability can change.',
  },
  {
    slug: 'united-kingdom-visa', country: 'United Kingdom', code: 'gb', title: 'United Kingdom Visa', kind: 'embassy', price: 499,
    processing: 'Typically 3-6 weeks', entries: 'varies',
    highlights: ['Help with the online application and biometric booking', 'Document checklist tailored to your trip'],
    tip: 'A biometrics visit at an authorised centre is commonly part of the process.',
  },
  {
    slug: 'canada-visa', country: 'Canada', code: 'ca', title: 'Canada Visa', kind: 'embassy', price: 479,
    processing: 'Typically 4-8 weeks', entries: 'varies',
    highlights: ['Guidance on the online account and forms', 'Help preparing supporting documents'],
    tip: 'Biometrics and additional documents may be requested after you submit your application.',
  },
  {
    slug: 'australia-visa', country: 'Australia', code: 'au', title: 'Australia Visa', kind: 'embassy', price: 469,
    processing: 'Typically 3-6 weeks', entries: 'varies',
    highlights: ['Help choosing the right visa subclass for your trip', 'Support with the online application'],
    tip: 'Health or character checks may apply for some travellers and can add to the timing.',
  },
];

export const SAMPLE_VISAS: SampleVisa[] = [
  ...EVISA_SPECS.map((spec, index) => build(spec, 100 - index)),
  ...EMBASSY_SPECS.map((spec, index) => build(spec, 60 - index)),
];

export const SAMPLE_SECTIONS: SampleSection[] = [
  {
    slug: 'evisa',
    title: 'Apply for your eVisa hassle-free',
    subtitle: 'Skip the queues by applying online. Share your details and documents and we handle the rest.',
    order: 1,
    published: true,
  },
  {
    slug: 'embassy',
    title: 'Travelling further? Plan your visa early',
    subtitle: 'Embassy and consulate visas take longer, so start well ahead of your departure date.',
    order: 2,
    published: true,
  },
];

export const SAMPLE_BANNERS: SampleBanner[] = [
  {
    eyebrow: 'Visa services',
    title: 'Heading to the UAE? Start your eVisa enquiry',
    subtitle: 'Dubai, Abu Dhabi and beyond',
    description: 'Tell us your travel plans and we will confirm the right visa, the current fee and the timing.',
    countryCode: 'ae',
    ctaLabel: 'View UAE eVisa',
    ctaHref: '/visas/uae-evisa',
    order: 1,
    published: true,
  },
  {
    eyebrow: 'Visa services',
    title: 'Planning a trip to Türkiye?',
    subtitle: 'From Istanbul to the coast',
    description: 'Check whether you need a visa and let our team guide the online application.',
    countryCode: 'tr',
    ctaLabel: 'View Türkiye eVisa',
    ctaHref: '/visas/turkiye-evisa',
    order: 2,
    published: true,
  },
  {
    eyebrow: 'Visa services',
    title: 'Singapore stopover or city break?',
    subtitle: 'Prepare your entry paperwork early',
    description: 'Share your dates and nationality and we will explain what applies and what to prepare.',
    countryCode: 'sg',
    ctaLabel: 'View Singapore eVisa',
    ctaHref: '/visas/singapore-evisa',
    order: 3,
    published: true,
  },
];
