/**
 * Original sample content for the Holidays feature. Every package is flagged `isSample: true`
 * and is hidden from public endpoints in production unless HOLIDAYS_ALLOW_SAMPLES=true.
 * Prices are AED per person. Ratings are intentionally left null (never invented).
 */

const IMAGES = {
  skyline: { url: '/images/destination-03.jpg', alt: 'Dubai skyline with towers rising above the city' },
  resort: { url: '/images/destination-01.jpg', alt: 'Resort shoreline with sun loungers and calm water' },
  classical: { url: '/images/destination-05.jpg', alt: 'Classical architecture with columns and carved stonework' },
  yachtBay: { url: '/images/destination-a.jpg', alt: 'Aerial view of yachts anchored in a turquoise bay' },
  safari: { url: '/images/destination-b.jpg', alt: 'Giraffe standing in open safari landscape' },
  boat: { url: '/images/destination-c.jpg', alt: 'Friends laughing together on a boat trip' },
  gate: { url: '/images/destination-d.jpg', alt: 'Intricately carved historic gate' },
  iceCave: { url: '/images/destination-e.jpg', alt: 'Aerial view of an ice cave in a frozen landscape' },
  cliffBeach: { url: '/images/destination-f.jpg', alt: 'Secluded beach below sandy cliffs' },
} as const;

type ImageKey = keyof typeof IMAGES;

export interface SamplePackage {
  slug: string;
  title: string;
  summary: string;
  description: string;
  destinations: string[];
  country: string;
  durationNights: number;
  durationDays: number;
  price: { amount: number; currency: string };
  salePrice?: { amount: number; currency: string };
  images: { url: string; alt: string }[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  itinerary: { day: number; title: string; description: string }[];
  themes: string[];
  collections: string[];
  rating: null;
  popularity: number;
  published: boolean;
  isSample: boolean;
}

interface Spec {
  slug: string;
  title: string;
  summary: string;
  paragraphs: [string, string] | [string, string, string];
  city: string;
  country: string;
  nights: number;
  price: number;
  sale?: number;
  popularity: number;
  themes: string[];
  collections: string[];
  images: ImageKey[];
  highlights: string[];
  inclusions: string[];
  days: [string, string][];
}

const UAE = 'United Arab Emirates';

const COMMON_EXCLUSIONS = [
  'International flights',
  'Visa fees where required',
  'Travel insurance',
  'Meals not listed in the inclusions',
  'Personal expenses and tips',
];

function build(spec: Spec): SamplePackage {
  if (spec.days.length !== spec.nights + 1) {
    throw new Error(`${spec.slug}: itinerary has ${spec.days.length} days, expected ${spec.nights + 1}`);
  }
  return {
    slug: spec.slug,
    title: spec.title,
    summary: spec.summary,
    description: spec.paragraphs.join('\n\n'),
    destinations: [spec.city],
    country: spec.country,
    durationNights: spec.nights,
    durationDays: spec.nights + 1,
    price: { amount: spec.price, currency: 'AED' },
    ...(spec.sale ? { salePrice: { amount: spec.sale, currency: 'AED' } } : {}),
    images: spec.images.map((key) => ({ ...IMAGES[key] })),
    highlights: spec.highlights,
    inclusions: spec.inclusions,
    exclusions: COMMON_EXCLUSIONS,
    itinerary: spec.days.map(([title, description], index) => ({ day: index + 1, title, description })),
    themes: spec.themes,
    collections: spec.collections,
    rating: null,
    popularity: spec.popularity,
    published: true,
    isSample: true,
  };
}

const specs: Spec[] = [
  {
    slug: 'dubai-skyline-city-break',
    title: 'Dubai Skyline City Break',
    summary: 'Three easy nights in the city: observation decks, old souks and a sunset on the water.',
    paragraphs: [
      'This short break packs the best of Dubai into a relaxed schedule. You stay in a central hotel, so the towers, the creek and the shopping districts are all a short ride away.',
      'Mornings are free for sleeping in or by the pool, while afternoons are built around a few well-chosen experiences. You will see the skyline from above, explore the old trading quarter by abra and finish with a dinner cruise.',
    ],
    city: 'Dubai',
    country: UAE,
    nights: 3,
    price: 1890,
    sale: 1590,
    popularity: 95,
    themes: ['City Break', 'Family'],
    collections: ['dubai-stopover', 'weekend-getaways', 'popular-packages'],
    images: ['skyline', 'boat', 'yachtBay'],
    highlights: [
      'Observation deck visit with skyline views',
      'Abra ride across Dubai Creek',
      'Spice and gold souk walking tour',
      'Evening marina dinner cruise',
    ],
    inclusions: [
      '3 nights in a 4-star city hotel with breakfast',
      'Airport transfers in a private car',
      'Observation deck entry',
      'Old Dubai guided walk with abra ride',
      'Marina dinner cruise',
    ],
    days: [
      ['Arrival and marina evening', 'Meet your driver at the airport, check in and enjoy a free evening along the waterfront promenade.'],
      ['Towers and shopping', 'Head up to the observation deck in the morning, then spend the afternoon at your own pace in the nearby shopping district.'],
      ['Old Dubai on foot', 'A guided walk through the creek-side souks, a traditional abra crossing and a taste of local sweets.'],
      ['Departure', 'Enjoy a final breakfast and a private transfer back to the airport.'],
    ],
  },
  {
    slug: 'dubai-family-fun-week',
    title: 'Dubai Family Fun Week',
    summary: 'Five nights of beaches, theme parks and desert adventure designed around children of all ages.',
    paragraphs: [
      'A week built for families who want variety without long transfers. Your hotel sits close to the beach and the activity days alternate with easy rest days so younger travellers never get tired.',
      'Expect a theme park day, a gentle desert experience with sandboarding for kids and plenty of time at the water. Everything is arranged with private transport, so strollers, snacks and sunscreen stay with you.',
      'Our itinerary is flexible: if the family would rather spend an extra day at the beach, your host can swap activities on the spot.',
    ],
    city: 'Dubai',
    country: UAE,
    nights: 5,
    price: 3450,
    popularity: 88,
    themes: ['Family', 'Beach'],
    collections: ['popular-packages'],
    images: ['resort', 'skyline', 'safari', 'boat'],
    highlights: [
      'Full day at a leading theme park',
      'Family-friendly desert evening with sandboarding',
      'Beach days with kids club access',
      'Aquarium and underwater zoo visit',
      'Private family transport throughout',
    ],
    inclusions: [
      '5 nights in a family room with breakfast',
      'Theme park entry for all travellers',
      'Desert evening with dinner and sandboarding',
      'Aquarium entry',
      'Private airport and activity transfers',
    ],
    days: [
      ['Arrival and beach time', 'Transfer to the hotel and let the children loose on the beach and in the pool.'],
      ['Theme park day', 'A full day of rides and shows with a private return transfer in the evening.'],
      ['Aquarium and mall stroll', 'Walk through the tunnel at the aquarium, then enjoy lunch and the fountain show.'],
      ['Desert evening', 'Late afternoon pick-up for dune driving, sandboarding, a camel photo stop and a barbecue dinner.'],
      ['Free day', 'A rest day for the pool, the beach or optional extras arranged by your host.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'dubai-stopover-express',
    title: 'Dubai Stopover Express',
    summary: 'Two nights and a packed day: the quickest way to see Dubai between flights.',
    paragraphs: [
      'Designed for travellers with a long layover, this package keeps logistics simple. Your transfer is waiting on arrival and your hotel is minutes from the main sights.',
      'One guided day takes you across the city with time to wander, so you leave having really seen it rather than just passed through.',
    ],
    city: 'Dubai',
    country: UAE,
    nights: 2,
    price: 1190,
    popularity: 92,
    themes: ['City Break'],
    collections: ['dubai-stopover', 'weekend-getaways'],
    images: ['skyline', 'yachtBay', 'gate'],
    highlights: [
      'Private airport meet and greet',
      'Guided half-day city tour',
      'Sunset stroll on the waterfront',
      'Late checkout available on request',
    ],
    inclusions: [
      '2 nights in a 3-star city hotel with breakfast',
      'Airport transfers in a private car',
      'Guided half-day city tour',
    ],
    days: [
      ['Arrival and rest', 'Arrive, transfer to your hotel and recharge before an easy evening walk.'],
      ['City highlights', 'A guided tour of the main landmarks with free time for lunch and shopping, ending with sunset by the water.'],
      ['Onward journey', 'Breakfast and a timed transfer to the airport for your next flight.'],
    ],
  },
  {
    slug: 'dubai-desert-and-marina-stopover',
    title: 'Dubai Desert and Marina Stopover',
    summary: 'Dunes by afternoon, marina lights by night: an active three-night stopover.',
    paragraphs: [
      'If a quiet layover is not your style, this stopover mixes adrenaline and ease. You drive the dunes, watch the sun go down over the sand and then swap to a cool evening at the marina.',
      'Hotel, transfers and both main activities are arranged, leaving you free to choose your own dinner spots.',
    ],
    city: 'Dubai',
    country: UAE,
    nights: 3,
    price: 1650,
    sale: 1390,
    popularity: 85,
    themes: ['Adventure', 'City Break'],
    collections: ['dubai-stopover', 'popular-packages'],
    images: ['safari', 'skyline', 'boat', 'yachtBay'],
    highlights: [
      'Dune driving in a 4x4 at sunset',
      'Falconry and camel photo stop',
      'Marina yacht cruise',
      'Flexible free time for the city',
    ],
    inclusions: [
      '3 nights in a 4-star hotel near the marina with breakfast',
      'Sunset desert safari with barbecue dinner',
      'Marina cruise',
      'Private airport transfers',
    ],
    days: [
      ['Arrival', 'Check in and unwind. The marina promenade is steps from the hotel.'],
      ['Sunset desert safari', 'Afternoon pick-up for dune driving, a sunset stop and a camp dinner under the stars.'],
      ['Marina cruise', 'Free morning, then a late-afternoon yacht cruise with views of the coastline skyline.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'dubai-luxury-escape',
    title: 'Dubai Luxury Escape',
    summary: 'Four nights in a five-star beachfront hotel with a private yacht afternoon and a chef-led dinner.',
    paragraphs: [
      'For travellers who want to be looked after, this escape focuses on space, service and a few memorable moments. You stay in a suite with sea views and your driver is on call throughout.',
      'Highlights include a private yacht afternoon along the coast and a long dinner at a high-floor restaurant overlooking the skyline.',
    ],
    city: 'Dubai',
    country: UAE,
    nights: 4,
    price: 5200,
    popularity: 80,
    themes: ['Luxury', 'Couples'],
    collections: ['popular-packages'],
    images: ['resort', 'yachtBay', 'skyline'],
    highlights: [
      'Sea-view suite in a five-star beachfront hotel',
      'Private yacht afternoon with refreshments',
      'Chef-led tasting dinner with skyline views',
      'Spa treatment for two',
      'Chauffeur transfers throughout',
    ],
    inclusions: [
      '4 nights in a sea-view suite with breakfast',
      'Private yacht charter for 3 hours',
      'Tasting dinner for two',
      '60-minute spa treatment for two',
      'Chauffeur-driven airport transfers',
    ],
    days: [
      ['Arrival in style', 'Chauffeur pick-up and a welcome drink at check-in. The rest of the day is yours.'],
      ['Beach and spa', 'Slow morning on the private beach followed by a spa treatment for two.'],
      ['Yacht afternoon', 'Board a private yacht for a leisurely cruise along the coast with swimming stops.'],
      ['Skyline dinner', 'Free day, then a chef-led tasting dinner on a high floor overlooking the city.'],
      ['Departure', 'Late breakfast and a chauffeur transfer to the airport.'],
    ],
  },
  {
    slug: 'dubai-old-town-culture-break',
    title: 'Dubai Old Town Culture Break',
    summary: 'Heritage districts, a mosque visit and traditional cooking in a short, thoughtful stay.',
    paragraphs: [
      'Beyond the glass towers there is a quieter Dubai of wind towers, courtyards and trading houses. This break stays close to that heritage and gives it room to breathe.',
      'You will walk the historic quarter with a local guide, visit a mosque with a cultural talk and join a small group cooking class.',
    ],
    city: 'Dubai',
    country: UAE,
    nights: 3,
    price: 1720,
    popularity: 70,
    themes: ['Culture', 'City Break'],
    collections: ['dubai-stopover'],
    images: ['gate', 'classical', 'skyline'],
    highlights: [
      'Guided walk through the historic district',
      'Mosque visit with a cultural talk',
      'Emirati home-style cooking class',
      'Creek-side coffee and dates tasting',
    ],
    inclusions: [
      '3 nights in a heritage-district boutique hotel with breakfast',
      'Guided heritage walk',
      'Mosque visit with guide',
      'Cooking class with lunch',
      'Airport transfers',
    ],
    days: [
      ['Arrival', 'Settle in at your boutique hotel and enjoy coffee and dates in the courtyard.'],
      ['Heritage quarter', 'A morning walk through wind-tower lanes, museums and galleries with a local guide.'],
      ['Mosque and cooking class', 'A guided mosque visit and talk, then a hands-on cooking lesson and shared lunch.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'abu-dhabi-culture-and-coast',
    title: 'Abu Dhabi Culture and Coast',
    summary: 'Grand mosque, art museums and a quiet beach day over three relaxed nights.',
    paragraphs: [
      'Abu Dhabi offers calm streets, landmark architecture and long stretches of coastline. This stay pairs the cultural highlights with plenty of beach time.',
      'A guide leads you through the main sights on day two, and the rest of the trip is yours to enjoy at the pace you choose.',
    ],
    city: 'Abu Dhabi',
    country: UAE,
    nights: 3,
    price: 2150,
    popularity: 75,
    themes: ['Culture', 'Beach'],
    collections: ['weekend-getaways'],
    images: ['classical', 'resort', 'gate'],
    highlights: [
      'Guided visit to the grand mosque',
      'Art and heritage museum visit',
      'Corniche walk and beach day',
      'Traditional dinner by the water',
    ],
    inclusions: [
      '3 nights in a 4-star hotel with breakfast',
      'Guided culture day with entry fees',
      'Beach club day pass',
      'Private airport transfers',
    ],
    days: [
      ['Arrival', 'Check in and take an evening stroll along the Corniche.'],
      ['Culture day', 'Visit the grand mosque and a leading museum with your guide, finishing with dinner by the water.'],
      ['Beach day', 'A full day at a beach club with loungers and a lunch of fresh seafood.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'abu-dhabi-family-adventure',
    title: 'Abu Dhabi Family Adventure',
    summary: 'Theme park thrills, wildlife and a mangrove kayak across four family-friendly nights.',
    paragraphs: [
      'Abu Dhabi is full of surprises for children: indoor rides, wildlife parks and quiet mangrove channels. This trip strings them together with easy transfers.',
      'Evenings are low-key, with kid-friendly restaurants near the hotel and time to play on the beach.',
    ],
    city: 'Abu Dhabi',
    country: UAE,
    nights: 4,
    price: 2980,
    sale: 2590,
    popularity: 72,
    themes: ['Family', 'Adventure'],
    collections: ['popular-packages'],
    images: ['safari', 'resort', 'boat', 'classical'],
    highlights: [
      'Indoor theme park day',
      'Wildlife park drive-through',
      'Guided mangrove kayak trip',
      'Beach afternoon with kids club',
    ],
    inclusions: [
      '4 nights in a family suite with breakfast',
      'Theme park tickets',
      'Wildlife park entry',
      'Mangrove kayak tour',
      'Private transfers',
    ],
    days: [
      ['Arrival', 'Transfer to the hotel and enjoy a family dinner nearby.'],
      ['Theme park', 'A full day of indoor rides and shows, with time to rest between attractions.'],
      ['Wildlife day', 'Drive through the wildlife park and meet the animals on a guided walk.'],
      ['Mangrove kayaking', 'A gentle guided paddle through the mangroves followed by a beach afternoon.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'abu-dhabi-couples-retreat',
    title: 'Abu Dhabi Couples Retreat',
    summary: 'Two quiet nights with spa time, a sunset cruise and a romantic dinner.',
    paragraphs: [
      'A compact retreat for two, centred on rest. You stay in a resort-style hotel with a private stretch of beach and a full spa.',
      'The one planned outing is a sunset cruise followed by dinner, so the weekend never feels rushed.',
    ],
    city: 'Abu Dhabi',
    country: UAE,
    nights: 2,
    price: 2480,
    popularity: 60,
    themes: ['Couples', 'Luxury'],
    collections: ['weekend-getaways'],
    images: ['resort', 'yachtBay', 'cliffBeach'],
    highlights: [
      'Resort stay with private beach',
      'Sunset cruise along the coast',
      'Candlelit dinner for two',
      'Late checkout on the final day',
    ],
    inclusions: [
      '2 nights in a deluxe sea-view room with breakfast',
      'Sunset cruise for two',
      'Romantic dinner for two',
      'Spa credit per person',
      'Private airport transfers',
    ],
    days: [
      ['Arrival and spa', 'Check in, then use your spa credit before a relaxed dinner at the resort.'],
      ['Sunset cruise', 'Beach day followed by a sunset cruise and a candlelit dinner.'],
      ['Late checkout', 'Slow breakfast, late checkout and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'ras-al-khaimah-mountain-and-beach',
    title: 'Ras Al Khaimah Mountain and Beach',
    summary: 'Hike or zipline in the mountains by day and sleep beside the sea at night.',
    paragraphs: [
      'Ras Al Khaimah combines rugged peaks with a long, quiet coastline. This three-night trip gives you both without long drives.',
      'Adventure travellers can tackle a guided mountain trail or the zipline, while everyone else can pick a beach lounger and stay put.',
    ],
    city: 'Ras Al Khaimah',
    country: UAE,
    nights: 3,
    price: 1980,
    popularity: 78,
    themes: ['Adventure', 'Beach'],
    collections: ['beach-island-escapes', 'weekend-getaways'],
    images: ['cliffBeach', 'resort', 'safari'],
    highlights: [
      'Guided mountain viewpoint hike',
      'Optional zipline experience',
      'Beachfront resort stay',
      'Sunset at a hot-spring pool',
    ],
    inclusions: [
      '3 nights in a beachfront resort with breakfast',
      'Guided mountain hike',
      'Beach access with loungers',
      'Private airport transfers',
    ],
    days: [
      ['Arrival at the coast', 'Check in at the beach resort and watch the sun go down from the shoreline.'],
      ['Mountain day', 'A guided hike to a viewpoint with a picnic lunch. Zipline add-on available.'],
      ['Beach and hot springs', 'A slow morning on the sand and an evening soak in a hillside pool.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'ras-al-khaimah-beach-weekend',
    title: 'Ras Al Khaimah Beach Weekend',
    summary: 'Two nights of sun, sea and sand, with kayaking and a seafood dinner.',
    paragraphs: [
      'The quickest way to reset: a beach resort, warm water and nowhere you have to be. Kayaks and paddle boards are included, as is a seafood dinner on the first night.',
      'The resort is under an hour from the airport, so the weekend starts the moment you land.',
    ],
    city: 'Ras Al Khaimah',
    country: UAE,
    nights: 2,
    price: 1490,
    sale: 1290,
    popularity: 65,
    themes: ['Beach', 'Couples'],
    collections: ['beach-island-escapes', 'weekend-getaways'],
    images: ['resort', 'cliffBeach', 'yachtBay'],
    highlights: [
      'Beachfront resort with calm swimming water',
      'Kayak and paddle board use',
      'Seafood dinner on the first night',
      'Easy transfer from the airport',
    ],
    inclusions: [
      '2 nights in a beach resort with breakfast',
      'Seafood dinner for two',
      'Kayak and paddle board use',
      'Private airport transfers',
    ],
    days: [
      ['Arrival and seafood dinner', 'Check in, take a first swim and enjoy fresh seafood by the water.'],
      ['Water sports', 'Use the kayaks and paddle boards in the morning, then relax by the pool.'],
      ['Departure', 'Late breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'istanbul-two-continents-discovery',
    title: 'Istanbul Two Continents Discovery',
    summary: 'Five nights across Europe and Asia: bazaars, mosques, ferries and food.',
    paragraphs: [
      'Istanbul sits on two continents and this trip uses both. You start in the historic peninsula with its mosques and palaces, then cross the water to the Asian side for markets and neighbourhood cafes.',
      'A local guide leads three of the days while two are left open for shopping, wandering and long lunches.',
      'Ferry rides are part of the experience, giving you easy views of the skyline from the water.',
    ],
    city: 'Istanbul',
    country: 'Türkiye',
    nights: 5,
    price: 3100,
    popularity: 82,
    themes: ['Culture', 'City Break'],
    collections: ['popular-packages'],
    images: ['classical', 'gate', 'boat', 'yachtBay'],
    highlights: [
      'Guided tour of the historic peninsula',
      'Ferry crossing between Europe and Asia',
      'Covered bazaar shopping time',
      'Street food tasting walk',
      'Evening strait cruise',
    ],
    inclusions: [
      '5 nights in a central 4-star hotel with breakfast',
      'Guided historic peninsula tour with entry fees',
      'Food tasting walk',
      'Strait cruise',
      'Airport transfers',
    ],
    days: [
      ['Arrival', 'Meet your driver and settle into the hotel. A short evening walk finishes the day.'],
      ['Old city highlights', 'A full guided day through the main mosques, the palace quarter and the old hippodrome area.'],
      ['Bazaar day', 'Browse the covered bazaar with guidance on what to look for, then lunch in a local eatery.'],
      ['Across to Asia', 'A ferry crossing, a market visit and a seaside tea garden on the Asian shore.'],
      ['Food and strait cruise', 'A morning street food walk, a free afternoon and an evening cruise.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'istanbul-bosphorus-couples-escape',
    title: 'Istanbul Bosphorus Couples Escape',
    summary: 'Four nights of sunset terraces, hammam rituals and quiet waterside lanes.',
    paragraphs: [
      'This trip slows Istanbul down for two. You stay in a boutique hotel with a terrace, take a private sunset cruise and unwind in a traditional hammam.',
      'Free time is built in on purpose so you can wander, linger in cafes and discover the city together.',
    ],
    city: 'Istanbul',
    country: 'Türkiye',
    nights: 4,
    price: 3350,
    popularity: 68,
    themes: ['Couples', 'Culture'],
    collections: [],
    images: ['classical', 'yachtBay', 'gate'],
    highlights: [
      'Boutique hotel with rooftop terrace',
      'Private sunset strait cruise',
      'Traditional hammam experience',
      'Half-day guided old city walk',
    ],
    inclusions: [
      '4 nights in a boutique hotel with breakfast',
      'Private sunset cruise for two',
      'Hammam session for two',
      'Half-day guided walk',
      'Private transfers',
    ],
    days: [
      ['Arrival', 'Check in and watch the evening light from the hotel terrace.'],
      ['Old city walk', 'A half-day guided walk through the historic area, then free time.'],
      ['Hammam and leisure', 'A morning hammam ritual and an unscheduled afternoon in the nearby lanes.'],
      ['Sunset cruise', 'A private cruise on the strait at golden hour, followed by dinner.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'maldives-lagoon-escape',
    title: 'Maldives Lagoon Escape',
    summary: 'Five nights in a lagoon-side resort with snorkelling, sandbank picnics and sunsets.',
    paragraphs: [
      'Clear water, soft sand and almost no schedule. You stay on a small island resort where the house reef is a few steps from your villa.',
      'Included experiences are low-effort: a guided snorkel, a sandbank picnic by boat and a sunset cruise. The rest of the time is for swimming, reading and eating well.',
    ],
    city: 'Maldives',
    country: 'Maldives',
    nights: 5,
    price: 6900,
    popularity: 90,
    themes: ['Beach', 'Couples', 'Luxury'],
    collections: ['beach-island-escapes', 'popular-packages'],
    images: ['yachtBay', 'resort', 'cliffBeach', 'boat'],
    highlights: [
      'Beach villa steps from the house reef',
      'Guided snorkel with a marine naturalist',
      'Sandbank picnic by boat',
      'Sunset dolphin-spotting cruise',
      'Speedboat or seaplane transfer included',
    ],
    inclusions: [
      '5 nights in a beach villa with half board',
      'Return resort transfers',
      'Guided snorkel',
      'Sandbank picnic',
      'Sunset cruise',
    ],
    days: [
      ['Arrival by boat', 'Land at the airport and transfer to the island. Welcome drink and a first swim.'],
      ['Reef day', 'A guided snorkel on the house reef followed by an unhurried afternoon.'],
      ['Sandbank picnic', 'Head by boat to a sandbank for a picnic lunch and swimming in shallow water.'],
      ['Free day', 'Optional spa, kayaking or just time on the beach.'],
      ['Sunset cruise', 'An evening cruise watching for dolphins as the sun sets.'],
      ['Departure', 'Breakfast and the transfer back to the airport.'],
    ],
  },
  {
    slug: 'maldives-family-island-week',
    title: 'Maldives Family Island Week',
    summary: 'Eight nights on a family-friendly island with a kids club, shallow lagoon and reef lessons.',
    paragraphs: [
      'A long, unhurried island stay for families. The lagoon is shallow and calm, the kids club runs daily and rooms are set up for parents and children together.',
      'Over the week your family can join snorkel lessons, turtle talks and a boat picnic, and still have days with nothing planned at all.',
      'Meals are served on a flexible full-board plan so everyone can eat when they are hungry.',
    ],
    city: 'Maldives',
    country: 'Maldives',
    nights: 8,
    price: 8400,
    sale: 7600,
    popularity: 70,
    themes: ['Family', 'Beach'],
    collections: ['beach-island-escapes'],
    images: ['resort', 'cliffBeach', 'boat', 'yachtBay'],
    highlights: [
      'Daily kids club on the island',
      'Shallow lagoon ideal for children',
      'Junior snorkel lessons',
      'Boat picnic to a sandbank',
      'Full board dining',
    ],
    inclusions: [
      '8 nights in a family villa with full board',
      'Return resort transfers',
      'Kids club access',
      'Junior snorkel lesson',
      'Boat picnic',
    ],
    days: [
      ['Arrival', 'Transfer by boat to the island and settle into the family villa.'],
      ['Beach and lagoon', 'Easy first day paddling in the lagoon and exploring the beach.'],
      ['Snorkel lesson', 'A gentle introduction to snorkelling for children, led by a resort guide.'],
      ['Kids club day', 'Children join the club while parents enjoy the pool or spa.'],
      ['Free day', 'No schedule: swimming, sandcastles and rest.'],
      ['Boat picnic', 'A boat trip to a sandbank with a picnic and swimming.'],
      ['Turtle talk', 'A morning talk about local marine life and an optional guided reef swim.'],
      ['Farewell dinner', 'A relaxed family dinner on the beach.'],
      ['Departure', 'Breakfast and the transfer back to the airport.'],
    ],
  },
  {
    slug: 'baku-old-city-and-flame-towers',
    title: 'Baku Old City and Flame Towers',
    summary: 'Four nights in the Caspian capital: walled old town, modern towers and mud volcanoes.',
    paragraphs: [
      'Baku blends a medieval walled quarter with striking modern architecture. This trip walks you through both, with a day trip to see the natural wonders beyond the city.',
      'The pace is easy, with a central hotel that lets you step out for tea houses and evening promenades.',
    ],
    city: 'Baku',
    country: 'Azerbaijan',
    nights: 4,
    price: 2750,
    popularity: 55,
    themes: ['City Break', 'Culture'],
    collections: [],
    images: ['gate', 'classical', 'skyline'],
    highlights: [
      'Guided walk through the walled old town',
      'Evening views of the illuminated towers',
      'Day trip to mud volcanoes and rock art',
      'Tea house tasting stop',
    ],
    inclusions: [
      '4 nights in a central 4-star hotel with breakfast',
      'Old town guided walk',
      'Half-day excursion beyond the city',
      'Private airport transfers',
    ],
    days: [
      ['Arrival', 'Check in and take an evening stroll on the seaside promenade.'],
      ['Old town', 'A guided walk through the walled quarter, ending with a tea house break.'],
      ['Beyond the city', 'A half-day excursion to see mud volcanoes and ancient rock carvings.'],
      ['Modern Baku', 'Explore the modern districts at your own pace and see the towers lit at night.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'almaty-mountain-adventure',
    title: 'Almaty Mountain Adventure',
    summary: 'Six nights of alpine lakes, canyon hikes and mountain air outside Kazakhstan\'s southern city.',
    paragraphs: [
      'Almaty sits at the foot of high mountains and this itinerary heads straight into them. Guided day trips visit alpine lakes, a red-rock canyon and a high-altitude plateau.',
      'Between outdoor days you return to the city for hearty local food and a comfortable bed.',
      'Hikes are graded easy to moderate and your guide can adapt routes to the weather.',
    ],
    city: 'Almaty',
    country: 'Kazakhstan',
    nights: 6,
    price: 3900,
    sale: 3500,
    popularity: 58,
    themes: ['Adventure'],
    collections: [],
    images: ['iceCave', 'cliffBeach', 'safari', 'classical'],
    highlights: [
      'Alpine lake day trip with a guided hike',
      'Red-rock canyon walk',
      'Cable car to a mountain viewpoint',
      'Local food evening in the city',
      'Small-group guided transport',
    ],
    inclusions: [
      '6 nights in a 4-star city hotel with breakfast',
      '3 guided mountain day trips with transport',
      'Cable car ticket',
      'Airport transfers',
    ],
    days: [
      ['Arrival', 'Transfer to the hotel and rest ahead of the outdoor days.'],
      ['City orientation', 'A short guided city walk, a market visit and the cable car at sunset.'],
      ['Alpine lakes', 'A guided drive and hike to a deep blue mountain lake.'],
      ['Red-rock canyon', 'Walk through a colourful canyon with a picnic lunch.'],
      ['High plateau', 'A day on a mountain plateau with panoramic views and light hiking.'],
      ['Farewell dinner', 'A local food evening with regional dishes and music.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
  {
    slug: 'almaty-city-and-peaks-short-break',
    title: 'Almaty City and Peaks Short Break',
    summary: 'Three nights mixing city cafes, a cable car ride and one scenic mountain day.',
    paragraphs: [
      'A taste of Almaty for those with limited time. You get one day in the city and one in the mountains, with an evening to enjoy the local food scene.',
      'The schedule is gentle and works well as a first look before a longer visit.',
    ],
    city: 'Almaty',
    country: 'Kazakhstan',
    nights: 3,
    price: 2300,
    popularity: 45,
    themes: ['City Break', 'Adventure'],
    collections: ['weekend-getaways'],
    images: ['iceCave', 'classical', 'gate'],
    highlights: [
      'Cable car to a city viewpoint',
      'Scenic mountain day with a short hike',
      'Market and cafe tour',
      'Private airport transfers',
    ],
    inclusions: [
      '3 nights in a central hotel with breakfast',
      'Cable car ticket',
      'Guided mountain day trip',
      'Private airport transfers',
    ],
    days: [
      ['Arrival', 'Check in and enjoy a first evening in a local cafe.'],
      ['City and cable car', 'Explore the markets and ride the cable car for views across the city.'],
      ['Mountain day', 'A guided drive to a scenic lake with an easy walk and picnic.'],
      ['Departure', 'Breakfast and a private transfer to the airport.'],
    ],
  },
];

export const SAMPLE_PACKAGES: SamplePackage[] = specs.map(build);

export const SAMPLE_COLLECTIONS = [
  {
    slug: 'dubai-stopover',
    title: 'Dubai Stopover Packages',
    subtitle: 'Turn a layover into a trip with short stays that make the most of your time in Dubai.',
    order: 1,
    published: true,
  },
  {
    slug: 'beach-island-escapes',
    title: 'Beach and Island Escapes',
    subtitle: 'Warm water, soft sand and slow days from the Gulf coast to the Maldives.',
    order: 2,
    published: true,
  },
  {
    slug: 'weekend-getaways',
    title: 'Weekend Getaways',
    subtitle: 'Short breaks that fit around a working week.',
    order: 3,
    published: true,
  },
  {
    slug: 'popular-packages',
    title: 'Popular Packages',
    subtitle: 'The trips travellers ask us about most.',
    order: 4,
    published: true,
  },
];

export const SAMPLE_BANNERS = [
  {
    eyebrow: 'Dubai',
    title: 'Dubai, your way',
    subtitle: 'City breaks, desert evenings and family weeks',
    description: 'Build a trip around skyline views, souks and the sea with hotels and transfers sorted for you.',
    image: '/images/destination-03.jpg',
    ctaLabel: 'Explore Dubai packages',
    ctaHref: '/holidays/destination/Dubai',
    order: 1,
    published: true,
  },
  {
    eyebrow: 'Abu Dhabi',
    title: 'Abu Dhabi, calm and cultured',
    subtitle: 'Landmark architecture and quiet beaches',
    description: 'Museums, mosques and long coastal walks, paired with relaxed stays for families and couples.',
    image: '/images/destination-05.jpg',
    ctaLabel: 'Explore Abu Dhabi packages',
    ctaHref: '/holidays/destination/Abu%20Dhabi',
    order: 2,
    published: true,
  },
  {
    eyebrow: 'Maldives',
    title: 'Maldives island escapes',
    subtitle: 'Lagoons, reefs and unhurried days',
    description: 'Stay beside the reef, picnic on a sandbank and watch dolphins at sunset.',
    image: '/images/destination-01.jpg',
    ctaLabel: 'Explore Maldives packages',
    ctaHref: '/holidays/destination/Maldives',
    order: 3,
    published: true,
  },
];
