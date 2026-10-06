/**
 * Sample partners for development. Every name is FICTIONAL and deliberately generic: no real brands,
 * logos or trademarks, and nothing here implies a real partnership. `logo: null` makes the site render
 * a text wordmark. Real partners are loaded via the admin API or `seed:partners -- --file`.
 */
export const SAMPLE_PARTNERS = [
  { name: 'Skyline Observatory', category: 'Observation deck', order: 1 },
  { name: 'Desert Dune Park', category: 'Adventure park', order: 2 },
  { name: 'Harbour Aquarium', category: 'Aquarium', order: 3 },
  { name: 'Coral Reef Gardens', category: 'Nature & gardens', order: 4 },
  { name: 'Sky Tower Experience', category: 'Observation deck', order: 5 },
  { name: 'Heritage Fort Museum', category: 'Museum', order: 6 },
  { name: 'Palm Waterpark', category: 'Water park', order: 7 },
  { name: 'Midnight Lights Theme Park', category: 'Theme park', order: 8 },
  { name: 'Old Quarter Walking Tours', category: 'Guided tours', order: 9 },
  { name: 'Oasis Wildlife Reserve', category: 'Wildlife', order: 10 },
].map((p) => ({
  ...p,
  logo: null,
  href: null,
  placements: ['home', 'activities'],
  published: true,
  isSample: true,
}));
