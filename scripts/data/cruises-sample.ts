/**
 * Original sample content for the Cruises feature. Every cruise is flagged `isSample: true` and is
 * hidden from public endpoints in production unless CRUISES_ALLOW_SAMPLES=true.
 *
 * All cruise lines and ships below are FICTIONAL. Itineraries and fares are invented examples, so
 * the site never presents them as products of a real operator. Fares are INDICATIVE per-person
 * "from" prices in AED. Replace this data with verified products before launch
 * (`npm run seed:cruises -- --file cruises.json`).
 *
 * Departure dates are generated relative to the seed run date, so a re-seed always refreshes them.
 */

type StopType = 'port' | 'sea' | 'embark' | 'disembark';

interface Stop {
  type: StopType;
  port: string;
  country?: string;
  description: string;
}

export interface SampleCruise {
  slug: string;
  title: string;
  summary: string;
  description: string;
  coverImage: string;
  images: { url: string; alt: string }[];
  cruiseLine: string;
  shipName: string;
  departureCity: string;
  departureCountry: string;
  region: string;
  durationNights: number;
  durationDays: number;
  departures: string[];
  itinerary: (Stop & { day: number })[];
  cabins: { type: string; description: string; fromPrice: { amount: number; currency: string } }[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  notes: string;
  tags: string[];
  popularity: number;
  published: boolean;
  isSample: boolean;
}

export interface SampleBanner {
  eyebrow: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  ctaLabel: string;
  ctaHref: string;
  order: number;
  published: boolean;
}

const UAE = 'United Arab Emirates';

// --- Fictional operators -------------------------------------------------------------------

const AZURE = { cruiseLine: 'Azure Meridian Cruises', shipName: 'MV Horizon Star' };
const PEARL = { cruiseLine: 'Pearl Gulf Voyages', shipName: 'MV Coral Dawn' };
const NORTHWIND = { cruiseLine: 'Northwind Seas', shipName: 'MV Aurora Breeze' };
const COBALT = { cruiseLine: 'Cobalt Harbour Line', shipName: 'MV Marea Alta' };
const LANTERN = { cruiseLine: 'Lantern Isles Cruises', shipName: 'MV Jade Lantern' };
const SANDGLASS = { cruiseLine: 'Sandglass Sea Lines', shipName: 'MV Dune Pearl' };

// --- Images (existing files served at /images/<name>) ---------------------------------------

const IMG = {
  bay: { url: '/images/destination-a.jpg', alt: 'Aerial view of a yacht anchored in a sheltered turquoise bay' },
  boat: { url: '/images/destination-c.jpg', alt: 'Friends enjoying a day out together on a boat' },
  dubai: {
    url: '/images/destination-03.jpg',
    alt: 'Visitor walking along a Dubai waterfront promenade towards the city towers',
  },
  villa: {
    url: '/images/destination-01.jpg',
    alt: 'Thatched seaside villa with an infinity pool facing the open sea',
  },
  ruins: {
    url: '/images/destination-05.jpg',
    alt: 'Ancient columned temple ruins on a hillside under a pale morning sky',
  },
  town: { url: '/images/destination-hero.jpg', alt: 'Couple with a paper map exploring a town on foot' },
  cove: {
    url: '/images/destination-f.jpg',
    alt: 'Aerial view of a tropical cove with a beach cabin and clear turquoise water',
  },
  gateway: {
    url: '/images/destination-d.jpg',
    alt: 'Carved ancient temple gateway lit by the setting sun',
  },
};

const GALLERY = {
  gulf: [IMG.bay, IMG.boat, IMG.dubai, IMG.villa],
  med: [IMG.bay, IMG.ruins, IMG.boat, IMG.town],
  asia: [IMG.boat, IMG.cove, IMG.villa, IMG.bay],
  redSea: [IMG.bay, IMG.gateway, IMG.boat, IMG.cove],
};

// --- Itinerary building blocks --------------------------------------------------------------

const SEA_DAYS = [
  'A full day at sea to unwind: lounge on deck, try the onboard activities or simply watch the horizon.',
  'Enjoy a relaxed day on board with time for the pool, the spa and an unhurried meal.',
  'Cruising day with entertainment in the evening and plenty of space to slow down.',
  'The ship sails on through open water, giving you a restful day between ports.',
  'A day to explore the ship at your own pace before the next port comes into view.',
  'Spend the day at sea with deck games, a good book and sunset views from the stern.',
];

const HOME_PORTS: Record<string, { country: string; embark: string; disembark: string }> = {
  Dubai: {
    country: UAE,
    embark: 'Check in at the cruise terminal, settle into your cabin and sail out past the city skyline at dusk.',
    disembark: 'Return to Dubai in the morning, enjoy a final breakfast on board and disembark at the terminal.',
  },
  'Abu Dhabi': {
    country: UAE,
    embark: 'Board at the Abu Dhabi terminal, meet your cabin steward and join the sail-away on deck.',
    disembark: 'The ship docks back in Abu Dhabi, where you collect your luggage and disembark after breakfast.',
  },
  Istanbul: {
    country: 'Türkiye',
    embark: 'Board in Istanbul and sail along the Bosphorus as the minarets and old city walls slip past.',
    disembark: 'Arrive back in Istanbul with the city waking up around you, then disembark after breakfast.',
  },
  Barcelona: {
    country: 'Spain',
    embark: 'Board at the Barcelona harbour, explore the ship and wave goodbye to the city from the open deck.',
    disembark: 'The ship returns to Barcelona in the early morning and you disembark after a last breakfast.',
  },
  Singapore: {
    country: 'Singapore',
    embark: 'Board at the Singapore cruise centre and sail out through the busy strait at sunset.',
    disembark: 'Sail back into Singapore at dawn, finish breakfast on board and disembark at the terminal.',
  },
  Jeddah: {
    country: 'Saudi Arabia',
    embark: 'Board at the Jeddah seaport, find your cabin and sail out over the warm Red Sea at sunset.',
    disembark: 'The ship berths in Jeddah in the morning and guests disembark after breakfast.',
  },
};

const PORTS: Record<string, { country: string; description: string }> = {
  Khasab: {
    country: 'Oman',
    description:
      'A small port beneath the rugged Musandam mountains. Join a traditional dhow outing through the quiet inlets.',
  },
  Muscat: {
    country: 'Oman',
    description:
      'Stroll the seafront corniche and browse the old souq. White-washed buildings frame the harbour against dry hills.',
  },
  Fujairah: {
    country: UAE,
    description:
      'A relaxed stop on the Gulf of Oman coast. Time for a beach break or a drive to the nearby mountain villages.',
  },
  Sohar: {
    country: 'Oman',
    description:
      'A historic coastal town with a restored fort and a calm waterfront. A gentle, unhurried port day.',
  },
  Doha: {
    country: 'Qatar',
    description:
      'Wander the souq and the waterfront promenade. A modern skyline contrasts with museums that tell the local story.',
  },
  Manama: {
    country: 'Bahrain',
    description:
      'Explore the old quarter and the pearl-diving heritage sites. Cafes and markets are an easy walk from the port.',
  },
  'Sir Bani Yas Island': {
    country: UAE,
    description:
      'A wildlife-rich island with beaches and nature trails. Spend the day outdoors or simply relax on the sand.',
  },
  'Çanakkale': {
    country: 'Türkiye',
    description:
      'A lively waterfront town beside the Dardanelles. It is the gateway to ancient sites and quiet coastal villages.',
  },
  Izmir: {
    country: 'Türkiye',
    description:
      'A bustling Aegean city with a bazaar, seafront promenade and plenty of cafes. Easy to enjoy independently.',
  },
  Kusadasi: {
    country: 'Türkiye',
    description:
      'A resort town on the Aegean, close to some of the region\'s best-known ancient ruins. Return for a sunset sail-away.',
  },
  Bodrum: {
    country: 'Türkiye',
    description:
      'A harbour town crowned by a medieval castle, with a marina, white houses and relaxed waterfront dining.',
  },
  Marmaris: {
    country: 'Türkiye',
    description:
      'A pine-fringed bay with a lively marina and a small old town. Good for a swim or a boat trip along the coast.',
  },
  'Athens (Piraeus)': {
    country: 'Greece',
    description:
      'Gateway to the Greek capital and its ancient hilltop monuments. Allow time for the old neighbourhoods and tavernas.',
  },
  Mykonos: {
    country: 'Greece',
    description:
      'Whitewashed lanes, windmills and sandy beaches. Wander the maze-like old town before the evening departure.',
  },
  Rhodes: {
    country: 'Greece',
    description:
      'Walk the walled medieval town and its cobbled lanes, or head to a nearby beach for a swim.',
  },
  Marseille: {
    country: 'France',
    description:
      'A sunlit port city with an old harbour, fish market and hilltop views over the bay.',
  },
  Genoa: {
    country: 'Italy',
    description:
      'A historic harbour city of narrow lanes and grand palaces. Try the local focaccia on a stroll through the old centre.',
  },
  'Civitavecchia (Rome)': {
    country: 'Italy',
    description:
      'The port for Rome. Travel inland to the capital\'s landmarks or keep the day relaxed in the harbour town.',
  },
  Naples: {
    country: 'Italy',
    description:
      'A lively, characterful city beside the bay. Famous for pizza, busy lanes and views towards the volcano.',
  },
  'Palma de Mallorca': {
    country: 'Spain',
    description:
      'A graceful island capital with a grand cathedral, tapas bars and a long, walkable seafront.',
  },
  Valencia: {
    country: 'Spain',
    description:
      'A relaxed coastal city of orange-scented squares, modern architecture and wide city beaches.',
  },
  Ibiza: {
    country: 'Spain',
    description:
      'Beyond the nightlife, find a hilltop old town, quiet coves and clear shallow water for swimming.',
  },
  Valletta: {
    country: 'Malta',
    description:
      'A compact fortified capital of honey-coloured stone, with harbour views from every terrace.',
  },
  Malacca: {
    country: 'Malaysia',
    description:
      'A heritage town of colourful shophouses, riverside walks and a mix of cultures reflected in its food.',
  },
  'Port Klang': {
    country: 'Malaysia',
    description:
      'The gateway to Kuala Lumpur. Choose a city visit or keep it easy with a local market and a seafood lunch.',
  },
  Penang: {
    country: 'Malaysia',
    description:
      'George Town\'s street art, temples and hawker stalls make this a day for walking and eating well.',
  },
  Langkawi: {
    country: 'Malaysia',
    description:
      'A tropical island of beaches, mangroves and rainforest. Take a boat trip or relax on a sandy shore.',
  },
  Phuket: {
    country: 'Thailand',
    description:
      'Island beaches, a charming old town and island-hopping boat trips are all within reach of the port.',
  },
  Krabi: {
    country: 'Thailand',
    description:
      'Limestone cliffs rise from emerald water. Join a longtail boat outing or spend the day on the beach.',
  },
  Yanbu: {
    country: 'Saudi Arabia',
    description:
      'A Red Sea port town with a restored old quarter and a calm waterfront, ideal for a gentle first stop.',
  },
  'Sharm El Sheikh': {
    country: 'Egypt',
    description:
      'Known for clear Red Sea water and coral reefs. Snorkel from the shore or take a glass-bottom boat ride.',
  },
  Hurghada: {
    country: 'Egypt',
    description:
      'A long strip of Red Sea beaches with excellent snorkelling and boat trips to nearby reefs.',
  },
  Safaga: {
    country: 'Egypt',
    description:
      'A quiet Red Sea port that serves as a starting point for desert and historic-site excursions.',
  },
  Aqaba: {
    country: 'Jordan',
    description:
      'A small port city at the head of the Red Sea, surrounded by desert mountains and clear water.',
  },
};

/** Compact itinerary DSL: `H` = home port (embark/disembark), `S` = sea day, otherwise a port name. */
function itinerary(home: string, route: string[]): (Stop & { day: number })[] {
  const homeInfo = HOME_PORTS[home];
  let seaCount = 0;
  const stops: Stop[] = [
    { type: 'embark', port: home, country: homeInfo.country, description: homeInfo.embark },
    ...route.map((name): Stop => {
      if (name === 'S') {
        const description = SEA_DAYS[seaCount % SEA_DAYS.length];
        seaCount += 1;
        return { type: 'sea', port: 'At Sea', description };
      }
      const info = PORTS[name];
      if (!info) throw new Error(`Unknown sample port: ${name}`);
      return { type: 'port', port: name, country: info.country, description: info.description };
    }),
    { type: 'disembark', port: home, country: homeInfo.country, description: homeInfo.disembark },
  ];
  return stops.map((stop, index) => ({ day: index + 1, ...stop }));
}

// --- Cabins ---------------------------------------------------------------------------------

const CABIN_TYPES = {
  inside: {
    type: 'Inside',
    multiplier: 1,
    description: 'A comfortable interior cabin with twin or double beds and a private bathroom. No window.',
  },
  ocean: {
    type: 'Ocean View',
    multiplier: 1.2,
    description: 'A cabin with a picture window so you can watch the coastline pass by, plus a private bathroom.',
  },
  balcony: {
    type: 'Balcony',
    multiplier: 1.55,
    description: 'A cabin with its own private balcony and seating, ideal for morning coffee and sunsets.',
  },
  suite: {
    type: 'Suite',
    multiplier: 2.4,
    description: 'A spacious suite with a separate seating area, a private balcony and extra room to relax.',
  },
};

type CabinKey = keyof typeof CABIN_TYPES;

/** Indicative per-person fares that grow with the cabin category; `nightly` is the inside-cabin rate. */
function cabins(nights: number, nightly: number, keys: CabinKey[]) {
  return keys.map((key) => {
    const cabin = CABIN_TYPES[key];
    return {
      type: cabin.type,
      description: cabin.description,
      fromPrice: { amount: Math.round((nightly * nights * cabin.multiplier) / 10) * 10, currency: 'AED' },
    };
  });
}

// --- Departure dates (generated from the seed run date) --------------------------------------

const HORIZON_DAYS = 240;

/**
 * Two to four departures per month for roughly the next eight months, spread across each month and
 * varied per cruise. Only dates on or after today (UTC) are returned, as ISO `YYYY-MM-DD` strings.
 */
export function generateDepartures(index: number, now: Date = new Date()): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const last = today + HORIZON_DAYS * 86_400_000;
  const dates: string[] = [];
  for (let month = 0; month <= 8; month += 1) {
    const count = 2 + ((index + month) % 3);
    const step = Math.floor(27 / count);
    const offset = (index * 5 + month * 3) % 6;
    for (let k = 0; k < count; k += 1) {
      const time = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + month, 1 + offset + k * step);
      if (time >= today && time <= last) dates.push(new Date(time).toISOString().slice(0, 10));
    }
  }
  return dates;
}

// --- Shared copy ----------------------------------------------------------------------------

const NOTES =
  'Fares are indicative per-person starting prices and, like availability, are confirmed when you send an enquiry.';

const INCLUSIONS = [
  'Accommodation in your chosen cabin category',
  'Main dining room meals and selected buffet dining',
  'Onboard entertainment and activities',
  'Sailing between all ports on the itinerary',
];

const EXCLUSIONS = [
  'Flights and airport transfers',
  'Shore excursions',
  'Drinks packages and specialty dining',
  'Travel insurance and visas where required',
];

interface Draft {
  slug: string;
  title: string;
  summary: string;
  description: string;
  operator: { cruiseLine: string; shipName: string };
  home: string;
  region: string;
  gallery: { url: string; alt: string }[];
  cover: 'bay' | 'boat';
  nights: number;
  route: string[];
  nightly: number;
  cabinKeys: CabinKey[];
  highlights: string[];
  tags: string[];
  popularity: number;
}

const DRAFTS: Draft[] = [
  // Dubai
  {
    slug: 'four-nights-gulf-short-break-from-dubai',
    title: 'Four Nights Gulf Short Break',
    summary: 'A quick sailing from Dubai to the Musandam coast and Muscat, ideal for a first cruise.',
    description:
      'Sail from Dubai for a compact break that fits into a long weekend. You will call at two ports in Oman and enjoy a relaxed day at sea on the way home.\n\nIt is a gentle introduction to cruising, with time for the pool, the spa and an evening show.',
    operator: AZURE,
    home: 'Dubai',
    region: 'Arabian Gulf',
    gallery: GALLERY.gulf,
    cover: 'bay',
    nights: 4,
    route: ['Khasab', 'Muscat', 'S'],
    nightly: 330,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Sail away past the Dubai skyline',
      'Dhow outing option in the Musandam inlets',
      'A full afternoon in Muscat',
      'A long weekend that fits a short break',
    ],
    tags: ['Short break', 'Couples', 'First cruise'],
    popularity: 88,
  },
  {
    slug: 'seven-nights-arabian-gulf-highlights-from-dubai',
    title: 'Seven Nights Arabian Gulf Highlights',
    summary: 'Doha, Manama and a nature island on a week-long Gulf loop from Dubai.',
    description:
      'This week-long loop links the Gulf\'s best-known waterfronts with a day on a quiet island. Sea days are placed so that you always arrive in port rested.\n\nIt suits families and friends who want variety without long transfers between destinations.',
    operator: AZURE,
    home: 'Dubai',
    region: 'Arabian Gulf',
    gallery: GALLERY.gulf,
    cover: 'boat',
    nights: 7,
    route: ['S', 'Doha', 'Manama', 'S', 'Sir Bani Yas Island', 'Fujairah'],
    nightly: 360,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Four ports across the Gulf in one week',
      'A beach and nature day on Sir Bani Yas Island',
      'Old and new quarters in Doha and Manama',
      'Two relaxed days at sea',
    ],
    tags: ['Family', 'Friends', 'Sightseeing'],
    popularity: 92,
  },
  {
    slug: 'six-nights-oman-coast-voyage-from-dubai',
    title: 'Six Nights Oman Coast Voyage',
    summary: 'Fjord-like inlets, forts and quiet harbours along the Omani coast.',
    description:
      'Follow the Omani coastline from Dubai, calling at small ports where the mountains meet the sea. The pace is unhurried and the ports are easy to explore on foot.\n\nA good choice if you prefer scenery and culture over big-city bustle.',
    operator: PEARL,
    home: 'Dubai',
    region: 'Arabian Gulf',
    gallery: GALLERY.gulf,
    cover: 'bay',
    nights: 6,
    route: ['Fujairah', 'Khasab', 'Muscat', 'S', 'Sohar'],
    nightly: 345,
    cabinKeys: ['inside', 'balcony', 'suite'],
    highlights: [
      'Four ports along the Omani and Emirati coast',
      'Mountain and inlet scenery at Khasab',
      'Historic fort town of Sohar',
      'One day at sea to unwind',
    ],
    tags: ['Couples', 'Scenic', 'Culture'],
    popularity: 74,
  },
  // Abu Dhabi
  {
    slug: 'five-nights-island-escape-from-abu-dhabi',
    title: 'Five Nights Island Escape',
    summary: 'Beach time, wildlife and two Gulf capitals on a five-night sailing from Abu Dhabi.',
    description:
      'Leave Abu Dhabi for a sailing that mixes beach time with city strolls. The island day is built for relaxing, with swimming and nature trails close to the pier.\n\nThe itinerary keeps travel times short so that most days begin with a view of a new coastline.',
    operator: PEARL,
    home: 'Abu Dhabi',
    region: 'Arabian Gulf',
    gallery: GALLERY.gulf,
    cover: 'bay',
    nights: 5,
    route: ['Sir Bani Yas Island', 'Doha', 'S', 'Manama'],
    nightly: 340,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'A beach and nature day on Sir Bani Yas Island',
      'Waterfront strolls in Doha and Manama',
      'Evening entertainment on board',
    ],
    tags: ['Family', 'Beach', 'Short break'],
    popularity: 81,
  },
  {
    slug: 'nine-nights-grand-gulf-voyage-from-abu-dhabi',
    title: 'Nine Nights Grand Gulf Voyage',
    summary: 'A longer, more relaxed Gulf sailing with Oman, Bahrain and Qatar and several sea days.',
    description:
      'The most complete Gulf itinerary in our sample range, with generous time at sea between ports. It rewards guests who like to settle in and enjoy the ship as much as the destinations.\n\nSuites and balcony cabins are especially popular on this longer sailing.',
    operator: PEARL,
    home: 'Abu Dhabi',
    region: 'Arabian Gulf',
    gallery: GALLERY.gulf,
    cover: 'boat',
    nights: 9,
    route: ['S', 'Muscat', 'Khasab', 'S', 'Manama', 'Doha', 'S', 'Sir Bani Yas Island'],
    nightly: 410,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Five ports in four countries',
      'Three relaxed days at sea',
      'Coastal scenery at Khasab',
      'A final beach day on Sir Bani Yas Island',
      'Suites with extra living space',
    ],
    tags: ['Luxury', 'Couples', 'Long break'],
    popularity: 70,
  },
  // Istanbul
  {
    slug: 'seven-nights-aegean-classics-from-istanbul',
    title: 'Seven Nights Aegean Classics',
    summary: 'Turkish and Greek Aegean ports on a week-long sailing from Istanbul.',
    description:
      'Sail from the Bosphorus into the Aegean for a week of old harbours, island lanes and ancient coastlines. Each stop has a walkable centre, so you can explore at your own pace.\n\nThe single sea day gives you a pause before the final port.',
    operator: NORTHWIND,
    home: 'Istanbul',
    region: 'Mediterranean',
    gallery: GALLERY.med,
    cover: 'bay',
    nights: 7,
    route: ['Çanakkale', 'S', 'Mykonos', 'Rhodes', 'Bodrum', 'S'],
    nightly: 420,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Sailing out along the Bosphorus',
      'Whitewashed lanes of Mykonos',
      'The walled old town of Rhodes',
      'A castle-topped harbour at Bodrum',
    ],
    tags: ['Couples', 'Culture', 'Sightseeing'],
    popularity: 95,
  },
  {
    slug: 'eight-nights-mediterranean-escape-from-istanbul',
    title: 'Eight Nights Mediterranean Escape',
    summary: 'Athens, island ports and the Turkish coast on an eight-night loop from Istanbul.',
    description:
      'A well-balanced sailing that links the Greek capital with island harbours and two Turkish coastal towns. Port days are varied, from ancient monuments to quiet beaches.\n\nIt is our most popular sample itinerary from Istanbul for guests travelling as a family or in a group.',
    operator: NORTHWIND,
    home: 'Istanbul',
    region: 'Mediterranean',
    gallery: GALLERY.med,
    cover: 'boat',
    nights: 8,
    route: ['S', 'Athens (Piraeus)', 'Mykonos', 'Rhodes', 'Marmaris', 'Kusadasi', 'S'],
    nightly: 440,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'A day for the ancient monuments of Athens',
      'Island ports of Mykonos and Rhodes',
      'Two relaxed Turkish coastal stops',
      'Family-friendly mix of sightseeing and beach time',
      'Departure and return in Istanbul',
    ],
    tags: ['Family', 'Sightseeing', 'Friends'],
    popularity: 98,
  },
  {
    slug: 'four-nights-turkish-riviera-short-break-from-istanbul',
    title: 'Four Nights Turkish Riviera Short Break',
    summary: 'A compact Aegean sailing from Istanbul with two Turkish ports and a day at sea.',
    description:
      'A short, easy sailing for guests with limited time. You call at two Turkish ports, each with a pleasant waterfront and a choice of guided or independent visits.\n\nThe day at sea is placed so that you return to Istanbul refreshed.',
    operator: NORTHWIND,
    home: 'Istanbul',
    region: 'Mediterranean',
    gallery: GALLERY.med,
    cover: 'bay',
    nights: 4,
    route: ['Çanakkale', 'Izmir', 'S'],
    nightly: 380,
    cabinKeys: ['inside', 'balcony', 'suite'],
    highlights: [
      'Sail along the Bosphorus at the start and end',
      'Waterfront strolls in Çanakkale and Izmir',
      'A relaxed day at sea',
    ],
    tags: ['Short break', 'Couples', 'First cruise'],
    popularity: 77,
  },
  // Barcelona
  {
    slug: 'seven-nights-western-mediterranean-from-barcelona',
    title: 'Seven Nights Western Mediterranean',
    summary: 'France, Italy and the Balearic islands on a week-long loop from Barcelona.',
    description:
      'A classic western Mediterranean sailing that pairs a French port with two Italian highlights and two Spanish stops. There is time at each port for a long lunch and an unhurried walk.\n\nA comfortable choice for first-time visitors to the region.',
    operator: COBALT,
    home: 'Barcelona',
    region: 'Mediterranean',
    gallery: GALLERY.med,
    cover: 'boat',
    nights: 7,
    route: ['Marseille', 'Genoa', 'Civitavecchia (Rome)', 'S', 'Palma de Mallorca', 'Valencia'],
    nightly: 460,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'A day to visit Rome from Civitavecchia',
      'The old harbour of Marseille',
      'Palma de Mallorca and Valencia on the way back',
      'Five ports in three countries',
    ],
    tags: ['Couples', 'Culture', 'Sightseeing'],
    popularity: 90,
  },
  {
    slug: 'four-nights-balearic-weekend-from-barcelona',
    title: 'Four Nights Balearic Weekend',
    summary: 'Palma and Ibiza on a short, sunny sailing from Barcelona.',
    description:
      'A short sailing built around two Balearic islands. Spend one day in an elegant island capital and another among quiet coves and a hilltop old town.\n\nPerfect for a long weekend by the sea.',
    operator: COBALT,
    home: 'Barcelona',
    region: 'Mediterranean',
    gallery: GALLERY.med,
    cover: 'bay',
    nights: 4,
    route: ['Palma de Mallorca', 'Ibiza', 'S'],
    nightly: 400,
    cabinKeys: ['inside', 'ocean', 'balcony'],
    highlights: [
      'Palma\'s cathedral and old town',
      'Swim stops and coves around Ibiza',
      'A sunset sail-away from Barcelona',
    ],
    tags: ['Short break', 'Friends', 'Beach'],
    popularity: 79,
  },
  {
    slug: 'ten-nights-grand-mediterranean-from-barcelona',
    title: 'Ten Nights Grand Mediterranean',
    summary: 'A long, unhurried Mediterranean sailing with France, Italy, Malta and Spain.',
    description:
      'Our longest Mediterranean sample sailing, with generous time at sea and a wide range of ports. Suites and balcony cabins are well suited to a trip of this length.\n\nExpect a relaxed rhythm of port days followed by quiet evenings on board.',
    operator: COBALT,
    home: 'Barcelona',
    region: 'Mediterranean',
    gallery: GALLERY.med,
    cover: 'boat',
    nights: 10,
    route: ['Marseille', 'Genoa', 'Civitavecchia (Rome)', 'Naples', 'S', 'Valletta', 'S', 'Palma de Mallorca', 'Valencia'],
    nightly: 480,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Seven ports in four countries',
      'Rome, Naples and Valletta in one sailing',
      'Two quiet days at sea',
      'Suites with extra living space',
      'A relaxed return via the Spanish coast',
    ],
    tags: ['Luxury', 'Couples', 'Long break'],
    popularity: 72,
  },
  // Singapore
  {
    slug: 'four-nights-malacca-strait-short-break-from-singapore',
    title: 'Four Nights Malacca Strait Short Break',
    summary: 'Heritage towns and a day at sea on a short sailing from Singapore.',
    description:
      'A short sailing along the Malacca Strait for travellers with limited time. You visit a heritage town and the gateway to Kuala Lumpur, with a day at sea to unwind.\n\nA friendly first cruise for families.',
    operator: LANTERN,
    home: 'Singapore',
    region: 'Southeast Asia',
    gallery: GALLERY.asia,
    cover: 'boat',
    nights: 4,
    route: ['Malacca', 'Port Klang', 'S'],
    nightly: 320,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Colourful shophouses and river walks in Malacca',
      'A choice of city or market day from Port Klang',
      'A day at sea with family-friendly activities',
    ],
    tags: ['Family', 'Short break', 'First cruise'],
    popularity: 83,
  },
  {
    slug: 'seven-nights-penang-and-phuket-from-singapore',
    title: 'Seven Nights Penang and Phuket',
    summary: 'Street food, island beaches and a Malaysian heritage stop on a week from Singapore.',
    description:
      'Sail north from Singapore to the island towns of Penang and Langkawi, then on to Phuket. The itinerary balances food, beaches and gentle sightseeing.\n\nSea days at the start and end let you settle in and wind down.',
    operator: LANTERN,
    home: 'Singapore',
    region: 'Southeast Asia',
    gallery: GALLERY.asia,
    cover: 'boat',
    nights: 7,
    route: ['S', 'Penang', 'Langkawi', 'Phuket', 'S', 'Malacca'],
    nightly: 380,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Street art and hawker food in Penang',
      'Beach time on Langkawi',
      'A day in Phuket for beaches or island trips',
      'Two relaxed days at sea',
    ],
    tags: ['Couples', 'Beach', 'Food'],
    popularity: 91,
  },
  {
    slug: 'ten-nights-andaman-adventure-from-singapore',
    title: 'Ten Nights Andaman Adventure',
    summary: 'Island hopping and limestone cliffs on a long sailing from Singapore.',
    description:
      'A longer voyage for guests who want to see more of the Andaman Sea. The route includes three island ports and a pair of Malaysian heritage stops on the way back.\n\nThree days at sea keep the pace gentle.',
    operator: LANTERN,
    home: 'Singapore',
    region: 'Southeast Asia',
    gallery: GALLERY.asia,
    cover: 'bay',
    nights: 10,
    route: ['S', 'Penang', 'Langkawi', 'Phuket', 'Krabi', 'S', 'Port Klang', 'Malacca', 'S'],
    nightly: 420,
    cabinKeys: ['inside', 'balcony', 'suite'],
    highlights: [
      'Six ports across Malaysia and Thailand',
      'Limestone scenery near Krabi',
      'Boat-trip options around Phuket and Langkawi',
      'Three relaxed days at sea',
      'A balcony to enjoy the island views',
    ],
    tags: ['Luxury', 'Couples', 'Long break'],
    popularity: 68,
  },
  // Jeddah
  {
    slug: 'five-nights-red-sea-discovery-from-jeddah',
    title: 'Five Nights Red Sea Discovery',
    summary: 'Clear water, coral reefs and two countries on a five-night sailing from Jeddah.',
    description:
      'Sail from Jeddah to a Saudi harbour town and two Egyptian resorts known for their reefs. Port days are built around snorkelling, boat trips and relaxed beach time.\n\nA day at sea on the way back gives you time to rest before returning to Jeddah.',
    operator: SANDGLASS,
    home: 'Jeddah',
    region: 'Red Sea',
    gallery: GALLERY.redSea,
    cover: 'bay',
    nights: 5,
    route: ['Yanbu', 'Sharm El Sheikh', 'Hurghada', 'S'],
    nightly: 350,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Snorkelling and reef trips on the Egyptian coast',
      'A calm old quarter in Yanbu',
      'Sunset sail-aways over the Red Sea',
    ],
    tags: ['Family', 'Beach', 'Snorkelling'],
    popularity: 80,
  },
  {
    slug: 'eight-nights-red-sea-grand-voyage-from-jeddah',
    title: 'Eight Nights Red Sea Grand Voyage',
    summary: 'Saudi, Jordanian and Egyptian ports along the length of the Red Sea.',
    description:
      'A fuller Red Sea sailing that adds Jordan and a second Egyptian resort to the route. Ports suit a mix of snorkelling, desert excursions and quiet waterfront strolls.\n\nSea days at each end of the route keep the pace comfortable.',
    operator: SANDGLASS,
    home: 'Jeddah',
    region: 'Red Sea',
    gallery: GALLERY.redSea,
    cover: 'boat',
    nights: 8,
    route: ['Yanbu', 'S', 'Aqaba', 'Sharm El Sheikh', 'Safaga', 'Hurghada', 'S'],
    nightly: 390,
    cabinKeys: ['inside', 'ocean', 'balcony', 'suite'],
    highlights: [
      'Five ports across three countries',
      'Desert and mountain scenery around Aqaba',
      'Reef snorkelling at Sharm El Sheikh and Hurghada',
      'Two relaxed days at sea',
      'Suites with extra living space',
    ],
    tags: ['Luxury', 'Couples', 'Snorkelling'],
    popularity: 73,
  },
];

export const SAMPLE_CRUISES: SampleCruise[] = DRAFTS.map((draft, index) => {
  const homeInfo = HOME_PORTS[draft.home];
  const stops = itinerary(draft.home, draft.route);
  const nights = draft.nights;
  const cover = IMG[draft.cover];
  return {
    slug: draft.slug,
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    coverImage: cover.url,
    images: draft.gallery.map((image) => ({ url: image.url, alt: image.alt })),
    cruiseLine: draft.operator.cruiseLine,
    shipName: draft.operator.shipName,
    departureCity: draft.home,
    departureCountry: homeInfo.country,
    region: draft.region,
    durationNights: nights,
    durationDays: stops.length,
    departures: generateDepartures(index),
    itinerary: stops,
    cabins: cabins(nights, draft.nightly, draft.cabinKeys),
    highlights: draft.highlights,
    inclusions: INCLUSIONS,
    exclusions: EXCLUSIONS,
    notes: NOTES,
    tags: draft.tags,
    popularity: draft.popularity,
    published: true,
    isSample: true,
  };
});

export const SAMPLE_BANNERS: SampleBanner[] = [
  {
    eyebrow: 'Cruises',
    title: 'Sail from Dubai',
    subtitle: 'Gulf voyages with the skyline behind you',
    description:
      'Short breaks and week-long sailings that start and end in Dubai, with ports in Oman, Bahrain and Qatar.',
    image: IMG.bay.url,
    ctaLabel: 'Explore Dubai sailings',
    ctaHref: '/cruises/from/Dubai',
    order: 1,
    published: true,
  },
  {
    eyebrow: 'Cruises',
    title: 'Mediterranean escapes from Istanbul',
    subtitle: 'Aegean islands, ancient coastlines and Turkish harbours',
    description:
      'Sail out along the Bosphorus and wake up in a new port each day, from short breaks to week-long loops.',
    image: IMG.ruins.url,
    ctaLabel: 'Explore Istanbul sailings',
    ctaHref: '/cruises/from/Istanbul',
    order: 2,
    published: true,
  },
  {
    eyebrow: 'Cruises',
    title: 'Southeast Asia from Singapore',
    subtitle: 'Island beaches, heritage towns and street food',
    description:
      'Sail north from Singapore to Malaysian and Thai ports, with sea days to relax in between.',
    image: IMG.cove.url,
    ctaLabel: 'Explore Singapore sailings',
    ctaHref: `/cruises/from/${encodeURIComponent('Singapore')}`,
    order: 3,
    published: true,
  },
];
