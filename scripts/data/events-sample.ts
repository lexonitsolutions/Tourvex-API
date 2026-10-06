/**
 * Original sample content for the Events feature. Every event is flagged `isSample: true` and is
 * hidden from public endpoints in production unless EVENTS_ALLOW_SAMPLES=true.
 *
 * All event names, venues and addresses below are FICTIONAL: no real artists, teams, brands, shows
 * or venues, so the site never presents invented events as if a real promoter staged them. Prices
 * are INDICATIVE per-ticket "from" prices in AED. Replace this data with verified events before
 * launch (`npm run seed:events -- --file events.json`).
 *
 * Sessions are generated relative to the seed run date (UTC evenings, 18:00 to 21:30), so a re-seed
 * always refreshes them and none is ever in the past.
 */

export interface SampleEvent {
  slug: string;
  title: string;
  summary: string;
  description: string;
  coverImage: string;
  images: { url: string; alt: string }[];
  category: string;
  venue: string;
  venueAddress: string;
  city: string;
  country: string;
  durationMinutes: number;
  sessions: { startsAt: string; doorsOpenAt: string }[];
  ticketTypes: { type: string; description: string; price: { amount: number; currency: string } }[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  ageGuidance: string;
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
const QATAR = 'Qatar';
const KSA = 'Saudi Arabia';

// --- Images: existing frontend files only (/images/<name>), rotated ---------------------------

const IMAGE_POOL = [
  'destination-a',
  'destination-b',
  'destination-c',
  'destination-d',
  'destination-e',
  'destination-f',
  'destination-01',
  'destination-02',
  'destination-03',
  'destination-05',
  'a1',
  'a2',
  'a3',
  'a4',
  'a',
  'c',
  'e',
  'f',
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '1',
  '2',
  '3',
  '4',
  '5',
  '7',
  '8',
].map((name) => `/images/${name}.jpg`);

const image = (index: number) =>
  IMAGE_POOL[((index % IMAGE_POOL.length) + IMAGE_POOL.length) % IMAGE_POOL.length];

// --- Per-category building blocks -------------------------------------------------------------

type Tier = { type: string; description: string; factor: number };

const TIERS: Record<string, Tier[]> = {
  Concerts: [
    {
      type: 'General Admission',
      description: 'Standing or open-seating entry for one person.',
      factor: 1,
    },
    { type: 'Premium', description: 'Reserved area with a closer view of the stage.', factor: 1.9 },
    {
      type: 'VIP Lounge',
      description: 'Lounge access with a dedicated entrance and seating.',
      factor: 3.6,
    },
  ],
  Sports: [
    { type: 'Standard Seat', description: 'Unreserved seating in the main stands.', factor: 1 },
    {
      type: 'Courtside / Pitchside',
      description: 'Seats close to the action on a reserved row.',
      factor: 2.2,
    },
    { type: 'Hospitality', description: 'Reserved seat with a hosted lounge area.', factor: 3.8 },
  ],
  Festivals: [
    { type: 'Day Pass', description: 'Entry for one person for a single festival day.', factor: 1 },
    {
      type: 'Weekend Pass',
      description: 'Entry for one person across the festival weekend.',
      factor: 1.7,
    },
    {
      type: 'Premium Pass',
      description: 'Entry with access to a quieter premium viewing area.',
      factor: 2.8,
    },
    { type: 'Group of 4', description: 'Four day passes bought together.', factor: 3.5 },
  ],
  Comedy: [
    { type: 'Standard', description: 'Unreserved seating for one person.', factor: 1 },
    { type: 'Front Section', description: 'Reserved seating nearer the stage.', factor: 1.6 },
  ],
  Family: [
    {
      type: 'Child (3-12)',
      description: 'One child ticket; children under 3 are usually free on a lap.',
      factor: 1,
    },
    { type: 'Adult', description: 'One adult ticket.', factor: 1.3 },
    {
      type: 'Family Pack (2+2)',
      description: 'Two adults and two children together.',
      factor: 3.6,
    },
  ],
  Theatre: [
    { type: 'Balcony', description: 'Raised seating with a full view of the stage.', factor: 1 },
    { type: 'Stalls', description: 'Ground-level seating closer to the performers.', factor: 1.6 },
    {
      type: 'Premium Stalls',
      description: 'Centre-block seating with a priority entrance.',
      factor: 2.4,
    },
  ],
  Exhibitions: [
    { type: 'Standard Entry', description: 'Timed entry for one person.', factor: 1 },
    { type: 'Weekend Entry', description: 'Entry for one person on weekend dates.', factor: 1.3 },
    {
      type: 'Guided Visit',
      description: 'Entry with a small-group guided walk-through.',
      factor: 2.1,
    },
  ],
};

const INCLUSIONS: Record<string, string[]> = {
  Concerts: ['Entry for the selected session', 'Access to the general venue facilities'],
  Sports: ['Entry for the selected session', 'Seat in the area of the ticket type chosen'],
  Festivals: [
    'Entry to the festival grounds on the pass days',
    'Access to the main stages and open areas',
  ],
  Comedy: ['Entry for the selected show', 'Seat in the section of the ticket type chosen'],
  Family: ['Entry for the selected show', 'Access to the family seating and facilities'],
  Theatre: ['Entry for the selected performance', 'Seat in the area of the ticket type chosen'],
  Exhibitions: ['Timed entry to the exhibition', 'Access to all open galleries'],
};

const EXCLUSIONS: Record<string, string[]> = {
  Concerts: ['Food and drink', 'Transport to and from the venue', 'Merchandise'],
  Sports: ['Food and drink', 'Transport to and from the venue', 'Parking'],
  Festivals: [
    'Food and drink',
    'Transport to and from the venue',
    'Activities that are priced separately',
  ],
  Comedy: ['Food and drink', 'Transport to and from the venue'],
  Family: ['Food and drink', 'Transport to and from the venue', 'Souvenirs'],
  Theatre: ['Food and drink', 'Transport to and from the venue', 'Programmes'],
  Exhibitions: ['Food and drink', 'Transport to and from the venue', 'Audio guides unless stated'],
};

const NOTES =
  'Sample listing: the event, venue and sessions are fictional examples. Prices are indicative per ticket and are confirmed by our team when you send an enquiry. Tickets are not sold online.';

const round5 = (value: number) => Math.round(value / 5) * 5;

function ticketTypes(category: string, base: number) {
  return TIERS[category].map((tier) => ({
    type: tier.type,
    description: tier.description,
    price: { amount: round5(base * tier.factor), currency: 'AED' },
  }));
}

// --- Sessions (generated from the seed run date) ----------------------------------------------

type Plan = 'weekly' | 'biweekly' | 'run' | 'pair';

const HORIZON_DAYS = 120;
/** 18:00, 18:30 ... 21:30 (UTC). */
const SLOTS_MINUTES = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => 18 * 60 + n * 30);

/**
 * Evening sessions (18:00 to 21:30 UTC) starting between 1 and 28 days after `now`, spread over
 * roughly four months: weekly and fortnightly runs, short consecutive-night runs, or a pair of
 * dates. Staggered per event so several events fall in every week. All are in the future.
 */
export function generateSessions(
  index: number,
  plan: Plan,
  now: Date = new Date(),
): { startsAt: string; doorsOpenAt: string }[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = 1 + ((index * 5) % 28);
  const minutes = SLOTS_MINUTES[index % SLOTS_MINUTES.length];
  const offsets: number[] = [];
  switch (plan) {
    case 'weekly':
      for (let k = 0; k < 15; k += 1) offsets.push(start + k * 7);
      break;
    case 'biweekly':
      for (let k = 0; k < 8; k += 1) offsets.push(start + k * 14 + (k % 2));
      break;
    case 'run':
      for (let k = 0; k < 6 + (index % 5); k += 1) offsets.push(start + k);
      break;
    case 'pair':
    default:
      offsets.push(start, start + 21 + (index % 14));
      break;
  }
  return offsets
    .filter((offset) => offset <= HORIZON_DAYS)
    .map((offset) => {
      const startsAt = today + offset * 86_400_000 + minutes * 60_000;
      return {
        startsAt: new Date(startsAt).toISOString(),
        doorsOpenAt: new Date(startsAt - 60 * 60_000).toISOString(),
      };
    });
}

// --- Fictional events -------------------------------------------------------------------------

interface Draft {
  title: string;
  category: string;
  venue: string;
  street: string;
  city: string;
  country: string;
  duration: number;
  plan: Plan;
  base: number;
  popularity: number;
  age: string;
  tags: string[];
  summary: string;
  blurb: string;
  highlights: string[];
}

const DRAFTS: Draft[] = [
  {
    title: 'Skyline Night Live',
    category: 'Concerts',
    venue: 'Harbour Arena',
    street: 'Harbour Road',
    city: 'Dubai',
    country: UAE,
    duration: 150,
    plan: 'weekly',
    base: 195,
    popularity: 95,
    age: 'All ages; under 12s with an adult',
    tags: ['Live music', 'Indoor'],
    summary: 'An evening of live pop and dance sets under a wall of city-skyline visuals.',
    blurb:
      'A fictional touring line-up takes the Harbour Arena stage for a high-energy evening built around layered lighting and a skyline-inspired set design.',
    highlights: [
      'Three live sets in one evening',
      'Large-format lighting and visuals',
      'Standing and reserved areas',
    ],
  },
  {
    title: 'Desert Echoes Acoustic Evening',
    category: 'Concerts',
    venue: 'Olive Bay Theatre',
    street: 'Bay Garden Street',
    city: 'Abu Dhabi',
    country: UAE,
    duration: 105,
    plan: 'biweekly',
    base: 145,
    popularity: 72,
    age: 'All ages',
    tags: ['Acoustic', 'Relaxed'],
    summary: 'Stripped-back acoustic songs and storytelling in an intimate seated theatre.',
    blurb:
      'A small ensemble plays acoustic arrangements and talks through the stories behind each song, with the house lights kept low and the volume comfortable.',
    highlights: [
      'Intimate seated setting',
      'Songs and stories between sets',
      'Comfortable sound levels',
    ],
  },
  {
    title: 'Neon Tide Electronic Night',
    category: 'Concerts',
    venue: 'Tidemark Arena',
    street: 'Seafront Boulevard',
    city: 'Doha',
    country: QATAR,
    duration: 210,
    plan: 'pair',
    base: 175,
    popularity: 80,
    age: '16+',
    tags: ['Electronic', 'Late evening'],
    summary: 'A night of electronic sets with a laser and projection show across the arena.',
    blurb:
      'Resident and guest performers from a fictional collective play back-to-back electronic sets while projections wash across the walls of Tidemark Arena.',
    highlights: ['Back-to-back live sets', 'Laser and projection show', 'Dedicated standing floor'],
  },
  {
    title: 'Falcon Ridge Symphony Evening',
    category: 'Concerts',
    venue: 'Acacia Theatre',
    street: 'Garden District Avenue',
    city: 'Riyadh',
    country: KSA,
    duration: 120,
    plan: 'biweekly',
    base: 165,
    popularity: 66,
    age: '6+',
    tags: ['Orchestral', 'Seated'],
    summary: 'A full orchestral programme of light classical favourites and film-style suites.',
    blurb:
      'A fictional chamber orchestra performs a programme of well-loved light classical pieces and cinematic suites in a seated, acoustically friendly hall.',
    highlights: [
      'Full orchestra on stage',
      'Accessible, crowd-pleasing programme',
      'Seated throughout',
    ],
  },
  {
    title: 'Lagoon Lights Open-Air Concert',
    category: 'Concerts',
    venue: 'Lagoon Amphitheatre',
    street: 'Lagoon Walk',
    city: 'Sharjah',
    country: UAE,
    duration: 135,
    plan: 'weekly',
    base: 110,
    popularity: 70,
    age: 'All ages',
    tags: ['Open-air', 'Family friendly', 'Outdoor'],
    summary: 'An open-air evening of live music beside the water, with lantern-style lighting.',
    blurb:
      'Tiered lawn seating faces a floating stage at the Lagoon Amphitheatre, where a rotating line-up of fictional bands plays as the evening cools.',
    highlights: [
      'Open-air stage by the water',
      'Lawn and tiered seating',
      'Lantern-style lighting',
    ],
  },
  {
    title: 'Harbour Cup Basketball Showcase',
    category: 'Sports',
    venue: 'Harbour Arena',
    street: 'Harbour Road',
    city: 'Dubai',
    country: UAE,
    duration: 150,
    plan: 'weekly',
    base: 120,
    popularity: 78,
    age: 'All ages',
    tags: ['Basketball', 'Indoor', 'Family friendly'],
    summary: 'A fast, floodlit exhibition tournament with half-time skills contests.',
    blurb:
      'Fictional city squads play a round-robin showcase in the Harbour Arena, with dunk and three-point contests between games.',
    highlights: [
      'Round-robin showcase games',
      'Half-time skills contests',
      'Seats close to the court',
    ],
  },
  {
    title: 'Sandline Sprint Athletics Night',
    category: 'Sports',
    venue: 'Sandline Stadium',
    street: 'Stadium Road',
    city: 'Abu Dhabi',
    country: UAE,
    duration: 180,
    plan: 'biweekly',
    base: 95,
    popularity: 64,
    age: 'All ages',
    tags: ['Athletics', 'Outdoor'],
    summary: 'Sprints, relays and field events under the stadium floodlights.',
    blurb:
      'Club athletes from across the region compete in sprints, relays and jumping events at an evening meeting designed for casual spectators as well as fans.',
    highlights: ['Sprints and relays', 'Field events in the infield', 'Evening floodlit meeting'],
  },
  {
    title: 'Dunecrest Padel Invitational',
    category: 'Sports',
    venue: 'Tidemark Arena',
    street: 'Seafront Boulevard',
    city: 'Doha',
    country: QATAR,
    duration: 165,
    plan: 'run',
    base: 130,
    popularity: 69,
    age: 'All ages',
    tags: ['Padel', 'Indoor'],
    summary: 'A multi-night padel invitational on a glass-walled show court.',
    blurb:
      'Invited club players compete over several nights on a glass-walled centre court, with small side courts open to spectators between sessions.',
    highlights: ['Glass-walled show court', 'Multi-night knockout format', 'Close-up seating'],
  },
  {
    title: 'Oasis Ridge Five-a-Side Football Festival',
    category: 'Sports',
    venue: 'Oasis Ridge Arena',
    street: 'Ridge Road',
    city: 'Riyadh',
    country: KSA,
    duration: 200,
    plan: 'pair',
    base: 100,
    popularity: 62,
    age: 'All ages',
    tags: ['Football', 'Community'],
    summary: 'Community five-a-side matches, skills zones and a fan area in one evening.',
    blurb:
      'Amateur teams compete in a fast-paced five-a-side tournament while spectators move between the pitches, skills zones and a casual fan area.',
    highlights: ['Fast five-a-side matches', 'Skills zones for visitors', 'Casual fan area'],
  },
  {
    title: 'Coastline Music Weekender',
    category: 'Festivals',
    venue: 'Harbour Lawn',
    street: 'Harbour Road',
    city: 'Dubai',
    country: UAE,
    duration: 300,
    plan: 'run',
    base: 160,
    popularity: 90,
    age: 'All ages; under 12s with an adult',
    tags: ['Music festival', 'Outdoor'],
    summary: 'A multi-stage music weekender on a waterside lawn, with food stalls and art corners.',
    blurb:
      'Two stages, a food-truck row and a small art corner share a waterside lawn for a relaxed weekend of live music from a fictional line-up.',
    highlights: [
      'Two stages with rotating line-ups',
      'Food-truck row and art corner',
      'Waterside lawn setting',
    ],
  },
  {
    title: 'Spice and Smoke Food Festival',
    category: 'Festivals',
    venue: 'Mosaic Courtyard',
    street: 'Heritage Quarter',
    city: 'Sharjah',
    country: UAE,
    duration: 240,
    plan: 'weekly',
    base: 100,
    popularity: 74,
    age: 'All ages',
    tags: ['Food', 'Family friendly', 'Outdoor'],
    summary: 'Open-fire cooking demos and regional street-food stalls in a tiled courtyard.',
    blurb:
      'Chefs cook over open flames in live demonstrations while stalls serve regional street food around a tiled courtyard, with music through the evening.',
    highlights: [
      'Live open-fire demonstrations',
      'Regional street-food stalls',
      'Evening music in the courtyard',
    ],
  },
  {
    title: 'Lantern Night Market Festival',
    category: 'Festivals',
    venue: 'Saltflat Pavilion',
    street: 'Pavilion Way',
    city: 'Abu Dhabi',
    country: UAE,
    duration: 270,
    plan: 'weekly',
    base: 95,
    popularity: 68,
    age: 'All ages',
    tags: ['Market', 'Family friendly', 'Evening'],
    summary: 'Lantern-lit stalls of crafts, snacks and small performances across the pavilion.',
    blurb:
      'Hundreds of lanterns light a night market of craft stalls, snack counters and short street performances spread across Saltflat Pavilion.',
    highlights: ['Lantern-lit market lanes', 'Craft and snack stalls', 'Short street performances'],
  },
  {
    title: 'Late Lantern Comedy Night',
    category: 'Comedy',
    venue: 'Lantern Court Theatre',
    street: 'Lantern Court',
    city: 'Dubai',
    country: UAE,
    duration: 120,
    plan: 'weekly',
    base: 120,
    popularity: 76,
    age: '16+',
    tags: ['Stand-up', 'Adults'],
    summary: 'A rotating bill of stand-up comedians in a cosy theatre room.',
    blurb:
      'A host introduces a different mix of fictional stand-up comedians each week, with short sets building to a longer closing act.',
    highlights: ['Rotating stand-up line-up', 'Host-led show', 'Small, close theatre room'],
  },
  {
    title: 'Stand-Up at the Bayline',
    category: 'Comedy',
    venue: 'Bayline Theatre',
    street: 'Bay Street',
    city: 'Doha',
    country: QATAR,
    duration: 110,
    plan: 'biweekly',
    base: 105,
    popularity: 63,
    age: '16+',
    tags: ['Stand-up', 'Adults'],
    summary: 'Observational stand-up from touring comedians in a relaxed seated venue.',
    blurb:
      'Touring comedians trade observational stand-up and quick crowd banter in a relaxed, seated show with a short interval.',
    highlights: ['Observational stand-up', 'Short interval', 'Seated throughout'],
  },
  {
    title: 'Laugh Ridge Open Mic Showcase',
    category: 'Comedy',
    venue: 'Falcon Court Hall',
    street: 'Court Avenue',
    city: 'Riyadh',
    country: KSA,
    duration: 100,
    plan: 'weekly',
    base: 95,
    popularity: 58,
    age: '16+',
    tags: ['Open mic', 'Adults'],
    summary: 'New and emerging comedians try fresh material in front of a live audience.',
    blurb:
      'Up-and-coming comedians test new material in short slots, followed by a headline set from a more experienced performer.',
    highlights: ['Fresh material from new comedians', 'Headline closing set', 'Casual atmosphere'],
  },
  {
    title: 'Puppet Parade Adventure',
    category: 'Family',
    venue: 'Lantern Court Theatre',
    street: 'Lantern Court',
    city: 'Dubai',
    country: UAE,
    duration: 60,
    plan: 'run',
    base: 95,
    popularity: 73,
    age: 'Ages 3-10 with an adult',
    tags: ['Family friendly', 'Puppets', 'Indoor'],
    summary: 'A colourful puppet adventure with songs and a sing-along finale.',
    blurb:
      'Hand-made puppets lead children on a story through a magical market, with songs, simple audience games and a sing-along to finish.',
    highlights: [
      'Hand-made puppets',
      'Songs and a sing-along finale',
      'One hour, suitable for young children',
    ],
  },
  {
    title: 'Little Explorers Science Show',
    category: 'Family',
    venue: 'Mosaic Hall',
    street: 'Heritage Quarter',
    city: 'Sharjah',
    country: UAE,
    duration: 75,
    plan: 'run',
    base: 95,
    popularity: 65,
    age: 'Ages 5-12 with an adult',
    tags: ['Family friendly', 'Science', 'Interactive'],
    summary: 'A hands-on science show with safe experiments and volunteers from the audience.',
    blurb:
      'A presenter runs safe, eye-catching experiments with bubbles, colour and air pressure, inviting children up to help.',
    highlights: ['Safe hands-on experiments', 'Audience volunteers', 'Q&A at the end'],
  },
  {
    title: 'Circus of Lights Family Spectacular',
    category: 'Family',
    venue: 'Saltflat Pavilion',
    street: 'Pavilion Way',
    city: 'Abu Dhabi',
    country: UAE,
    duration: 100,
    plan: 'run',
    base: 125,
    popularity: 85,
    age: 'All ages',
    tags: ['Family friendly', 'Circus', 'Indoor'],
    summary: 'Acrobats, jugglers and light-up performers in a fast, family-friendly show.',
    blurb:
      'Acrobats, jugglers and light-up performers fill the ring with short, fast-moving acts designed to keep younger audiences engaged.',
    highlights: ['Acrobatics and juggling', 'Light-up performance acts', 'Fast-paced short acts'],
  },
  {
    title: 'Storybook Garden Day',
    category: 'Family',
    venue: 'Dunecrest Hall',
    street: 'Garden Street',
    city: 'Doha',
    country: QATAR,
    duration: 90,
    plan: 'weekly',
    base: 95,
    popularity: 60,
    age: 'Ages 3-9 with an adult',
    tags: ['Family friendly', 'Storytelling'],
    summary: 'Storytelling corners, craft tables and a short stage show for young families.',
    blurb:
      'Storytellers read in themed corners, craft tables stay open for drop-in making, and a short stage show closes each session.',
    highlights: ['Themed storytelling corners', 'Drop-in craft tables', 'Short closing stage show'],
  },
  {
    title: 'The Last Ferry to Harbour Street',
    category: 'Theatre',
    venue: 'Lantern Court Theatre',
    street: 'Lantern Court',
    city: 'Dubai',
    country: UAE,
    duration: 130,
    plan: 'run',
    base: 160,
    popularity: 77,
    age: '12+',
    tags: ['Original play', 'Drama'],
    summary: 'An original drama about strangers sharing the last ferry of the night.',
    blurb:
      'A new, fictional play follows a handful of strangers sharing the final ferry crossing, as small conversations reveal larger stories.',
    highlights: ['New original play', 'Small ensemble cast', 'One interval'],
  },
  {
    title: 'Midnight at the Date Palm',
    category: 'Theatre',
    venue: 'Date Palm Theatre',
    street: 'Palm Street',
    city: 'Riyadh',
    country: KSA,
    duration: 120,
    plan: 'biweekly',
    base: 150,
    popularity: 67,
    age: '12+',
    tags: ['Mystery', 'Drama'],
    summary: 'A period mystery staged in a single, atmospheric set.',
    blurb:
      'A fictional whodunit unfolds over a single night in an old house, with tight staging, clever lighting and a twist in the final scene.',
    highlights: ['Single atmospheric set', 'Mystery with a twist ending', 'One interval'],
  },
  {
    title: 'Echoes of the Merchants: A New Musical',
    category: 'Theatre',
    venue: 'Olive Bay Theatre',
    street: 'Bay Garden Street',
    city: 'Abu Dhabi',
    country: UAE,
    duration: 140,
    plan: 'run',
    base: 185,
    popularity: 79,
    age: 'All ages',
    tags: ['Musical', 'Original'],
    summary: 'An original musical about a trading family and the harbour they built.',
    blurb:
      'A fictional original musical follows three generations of a trading family, with live music, choreography and period-inspired costumes.',
    highlights: [
      'Original songs and live music',
      'Choreographed ensemble numbers',
      'Period-inspired costumes',
    ],
  },
  {
    title: 'Light and Sand Immersive Exhibition',
    category: 'Exhibitions',
    venue: 'Creekside Exhibition Hall',
    street: 'Creek Road',
    city: 'Dubai',
    country: UAE,
    duration: 90,
    plan: 'weekly',
    base: 105,
    popularity: 82,
    age: 'All ages',
    tags: ['Immersive', 'Family friendly', 'Indoor'],
    summary: 'Projection rooms and sand-themed installations you can walk through.',
    blurb:
      'Visitors walk through a series of projection rooms and sand-themed installations that respond to movement, with quiet corners between rooms.',
    highlights: [
      'Walk-through projection rooms',
      'Movement-responsive installations',
      'Timed entry, relaxed pace',
    ],
  },
  {
    title: 'Modern Craft Showcase',
    category: 'Exhibitions',
    venue: 'Acacia Gallery Hall',
    street: 'Garden District Avenue',
    city: 'Riyadh',
    country: KSA,
    duration: 100,
    plan: 'run',
    base: 100,
    popularity: 57,
    age: 'All ages',
    tags: ['Crafts', 'Design', 'Indoor'],
    summary: 'Contemporary ceramics, textiles and woodwork from regional makers.',
    blurb:
      'A fictional showcase of contemporary ceramics, textiles and woodwork arranged in themed galleries, with short maker talks in the evenings.',
    highlights: ['Themed craft galleries', 'Short maker talks', 'Pieces from regional makers'],
  },
];

const buildEvent = (draft: Draft, index: number): SampleEvent => {
  const slug = draft.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const gallery = [index * 3, index * 3 + 1, index * 3 + 2].map((n) => ({
    url: image(n),
    alt: `${draft.title} - event photo`,
  }));
  return {
    slug,
    title: draft.title,
    summary: draft.summary,
    description: [
      draft.blurb,
      `This is a sample listing for ${draft.venue} in ${draft.city}. Sessions run in the evening, doors open an hour before the start, and we recommend arriving early to find your seat. Send an enquiry with your preferred session and ticket type and our team will reply with availability and the final price.`,
    ].join('\n\n'),
    coverImage: image(index * 3),
    images: gallery,
    category: draft.category,
    venue: draft.venue,
    venueAddress: `${draft.venue}, ${draft.street}, ${draft.city}, ${draft.country}`,
    city: draft.city,
    country: draft.country,
    durationMinutes: draft.duration,
    sessions: generateSessions(index, draft.plan),
    ticketTypes: ticketTypes(draft.category, draft.base),
    highlights: draft.highlights,
    inclusions: INCLUSIONS[draft.category],
    exclusions: EXCLUSIONS[draft.category],
    ageGuidance: draft.age,
    notes: NOTES,
    tags: draft.tags,
    popularity: draft.popularity,
    published: true,
    isSample: true,
  };
};

export const SAMPLE_EVENTS: SampleEvent[] = DRAFTS.map(buildEvent);

export const SAMPLE_BANNERS: SampleBanner[] = [
  {
    eyebrow: 'Events',
    title: 'Evenings out in Dubai',
    subtitle: 'Concerts, comedy, theatre and more',
    description:
      'Browse upcoming shows in Dubai and send us an enquiry for the dates and tickets you like.',
    image: image(0),
    ctaLabel: 'Explore Dubai events',
    ctaHref: '/events/in/Dubai',
    order: 1,
    published: true,
  },
  {
    eyebrow: 'Concerts',
    title: 'Live music across the Gulf',
    subtitle: 'From open-air nights to orchestral evenings',
    description: 'Find upcoming concerts in Dubai, Abu Dhabi, Sharjah, Doha and Riyadh.',
    image: image(7),
    ctaLabel: 'Browse concerts',
    ctaHref: '/events/category/concerts',
    order: 2,
    published: true,
  },
  {
    eyebrow: 'Family',
    title: 'Shows for all ages',
    subtitle: 'Puppets, science and circus fun',
    description:
      'Family-friendly shows and days out with simple ticket options for children and adults.',
    image: image(13),
    ctaLabel: 'Browse family events',
    ctaHref: '/events/category/family',
    order: 3,
    published: true,
  },
];
