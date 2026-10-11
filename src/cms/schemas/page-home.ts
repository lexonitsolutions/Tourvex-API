import type { DocumentSchema, SectionSchema } from '../cms.types';
import { color, image, link, select, text, textarea } from './fields';

const heading = (label = 'Heading') => text('heading', label, 120, { required: true });
const subheading = () => text('subheading', 'Subheading', 200);
const viewAll = (label = '"View all" link') => link('viewAll', label, { required: true });

export const HOME_EXPERIENCE_ICONS = [
  { value: 'desert', label: 'Sun over dunes' },
  { value: 'park', label: 'Ferris wheel' },
  { value: 'cruise', label: 'Ship' },
  { value: 'water', label: 'Waves' },
  { value: 'adventure', label: 'Mountain' },
  { value: 'city', label: 'City buildings' },
];

const hero: SectionSchema = {
  type: 'hero',
  label: 'Hero carousel',
  description: 'Top banner: destination slides (the desktop hero and the swipeable phone hero share these slides).',
  icon: 'image',
  fixed: true,
  single: true,
  canDisable: false,
  fields: [
    text('eyebrow', 'Eyebrow above the title', 60, { required: true }),
    text('slidesAriaLabel', 'Carousel label (screen readers)', 80, { required: true }),
    text('slideCounterLabel', 'Slide counter label (screen readers)', 60, {
      required: true,
      help: 'Use {index} and {total}, e.g. "{index} of {total}".',
    }),
    {
      name: 'slides',
      type: 'list',
      label: 'Slides',
      itemLabel: 'Slide',
      min: 1,
      max: 8,
      fields: [
        text('title', 'Title (destination)', 60, { required: true }),
        text('tagline', 'Tagline', 120, { required: true }),
        text('sub', 'Sub line (desktop only)', 200, { required: true }),
        link('cta', 'Button', { required: true }),
        image('image', 'Background image', { required: true, aspect: '16:9' }),
      ],
    },
  ],
};

const categoryTiles: SectionSchema = {
  type: 'categoryTiles',
  label: 'Category tiles',
  description: '"What are you looking for?" row of big coloured tiles.',
  icon: 'layout-grid',
  single: true,
  canDisable: true,
  fields: [
    heading(),
    subheading(),
    text('arrowLabel', 'Hover pill text', 40, { required: true }),
    {
      name: 'tiles',
      type: 'list',
      label: 'Tiles',
      itemLabel: 'Tile',
      min: 1,
      max: 8,
      fields: [
        link('link', 'Title and link', { required: true }),
        text('sub', 'Description', 120, { required: true }),
        text('emoji', 'Emoji', 8, { required: true }),
        color('gradientFrom', 'Gradient start', { required: true }),
        color('gradientMid', 'Gradient middle', { required: true }),
        color('gradientTo', 'Gradient end', { required: true }),
      ],
    },
  ],
};

const bestCities: SectionSchema = {
  type: 'bestCities',
  label: 'Best cities',
  description: 'Scrolling rail of destinations. City names and counts come from the activity catalogue.',
  icon: 'map-pin',
  single: true,
  canDisable: true,
  fields: [
    heading(),
    viewAll(),
    text('previousLabel', 'Previous button label (screen readers)', 40, { required: true }),
    text('nextLabel', 'Next button label (screen readers)', 40, { required: true }),
    text('cityTitle', 'City card title', 80, { required: true, help: 'Use {city}.' }),
    text('cityCount', 'City card count', 60, { required: true, help: 'Use {count}.' }),
  ],
};

const bestSellers: SectionSchema = {
  type: 'bestSellers',
  label: 'Best sellers',
  description: 'Numbered best-selling experience cards (edit titles, images, categories, and prices).',
  icon: 'star',
  single: true,
  canDisable: true,
  fields: [
    heading(),
    viewAll(),
    text('errorMessage', 'Message when activities cannot load', 200),
    text('fromLabel', '"From" price label', 40),
    text('priceOnRequest', 'Text when there is no price', 60),
    text('fallbackTag', 'Tag when an activity has no category', 40),
    text('cardAriaLabel', 'Card label (screen readers)', 120, { help: 'Use {title} and {price}.' }),
    {
      name: 'cards',
      type: 'list',
      label: 'Experience cards',
      itemLabel: 'Card',
      min: 1,
      max: 12,
      fields: [
        text('title', 'Experience title', 80, { required: true }),
        text('tag', 'Category badge (e.g. ADVENTURE TOURS, CITY TOURS)', 40, { required: true }),
        image('image', 'Card photo', { required: true, aspect: '16:9' }),
        text('price', 'Sale price (e.g. AED 799)', 40, { required: true }),
        text('oldPrice', 'Original crossed-out price (e.g. AED 1,499)', 40),
        link('link', 'Activity link', { required: true }),
      ],
    },
  ],
};

const holidays: SectionSchema = {
  type: 'holidays',
  label: 'Featured holidays',
  description: 'Holiday package teaser. Choose which packages to showcase from the catalogue.',
  icon: 'palmtree',
  single: true,
  canDisable: true,
  fields: [
    heading(),
    subheading(),
    viewAll(),
    text('emptyMessage', 'Message when there are no packages', 200, { required: true }),
    {
      name: 'packages',
      type: 'list',
      label: 'Featured holiday package cards',
      itemLabel: 'Package',
      max: 12,
      fields: [
        text('packageId', 'Package ID', 60),
        text('slug', 'Package slug', 120, { required: true }),
        text('title', 'Package title', 160, { required: true }),
        image('image', 'Card photo', { required: false, aspect: '4:3' }),
        text('country', 'Country / destination', 120),
        text('duration', 'Duration (e.g. 2N / 3D)', 60),
        text('price', 'Price', 60),
      ],
    },
  ],
};

const cruises: SectionSchema = {
  type: 'cruises',
  label: 'Cruises teaser',
  description: 'Cruise teaser (hidden automatically when there are no cruises).',
  icon: 'ship',
  single: true,
  canDisable: true,
  fields: [heading(), subheading(), viewAll()],
};

const events: SectionSchema = {
  type: 'events',
  label: 'Events teaser',
  description: 'Upcoming events teaser (hidden automatically when there are none).',
  icon: 'ticket',
  single: true,
  canDisable: true,
  fields: [heading(), subheading(), viewAll()],
};

const exploreByExperience: SectionSchema = {
  type: 'exploreByExperience',
  label: 'Explore by experience',
  description: 'Photo cards per activity category. The category name must match the catalogue category it links to.',
  icon: 'compass',
  single: true,
  canDisable: true,
  fields: [
    heading(),
    subheading(),
    viewAll('Mobile "View all" link'),
    text('ctaLabel', 'Card button text', 40, { required: true }),
    text('statsFallback', 'Text while counts are loading', 60, { required: true }),
    text('countOne', 'One experience', 60, { required: true, help: 'Use {count}.' }),
    text('countMany', 'Several experiences', 60, { required: true, help: 'Use {count}.' }),
    text('fromSuffix', 'Starting-price suffix', 60, { required: true, help: 'Use {price}, e.g. "• from {price}".' }),
    text('cardAriaLabel', 'Card label (screen readers)', 160, { required: true, help: 'Use {category} and {stats}.' }),
    {
      name: 'cards',
      type: 'list',
      label: 'Cards',
      itemLabel: 'Card',
      min: 1,
      max: 12,
      fields: [
        text('category', 'Category name', 60, { required: true, help: 'Also used as the catalogue filter, so it must match exactly.' }),
        select('icon', 'Icon', HOME_EXPERIENCE_ICONS, { required: true }),
        image('image', 'Photo', { required: true, aspect: '4:5' }),
        text('theme', 'Theme colour (HSL)', 30, {
          required: true,
          placeholder: '28 72% 26%',
          help: 'Hue saturation% lightness%, e.g. 28 72% 26%.',
          pattern: '^\\d{1,3} \\d{1,3}% \\d{1,3}%$',
          patternMessage: 'must look like "28 72% 26%"',
        }),
      ],
    },
  ],
};

const partners: SectionSchema = {
  type: 'partners',
  label: 'Partners strip',
  description: 'Logo marquee. The logos come from the Partners module; only the heading is edited here.',
  icon: 'handshake',
  single: true,
  canDisable: true,
  fields: [text('title', 'Heading', 120, { required: true }), text('subtitle', 'Subheading', 200)],
};

const why: SectionSchema = {
  type: 'why',
  label: 'Why book with us',
  description: 'Numbered reasons band at the bottom of the page.',
  icon: 'shield-check',
  single: true,
  canDisable: true,
  fields: [
    heading(),
    {
      name: 'items',
      type: 'list',
      label: 'Reasons',
      itemLabel: 'Reason',
      min: 1,
      max: 8,
      fields: [text('title', 'Title', 80, { required: true }), textarea('text', 'Text', 240, { required: true, rows: 2 })],
    },
  ],
};

export const HOME_SECTION_SCHEMAS: SectionSchema[] = [
  hero,
  categoryTiles,
  bestCities,
  bestSellers,
  holidays,
  cruises,
  events,
  exploreByExperience,
  partners,
  why,
];

export const PAGE_HOME_SCHEMA: DocumentSchema = {
  key: 'page.home',
  label: 'Home page',
  description: 'Every section of the home page, desktop and mobile.',
  kind: 'page',
  sections: {
    allowed: HOME_SECTION_SCHEMAS.map((section) => section.type),
    default: HOME_SECTION_SCHEMAS.map((section) => section.type),
  },
  previewPath: '/',
};
