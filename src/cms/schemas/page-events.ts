import type { DocumentSchema, SectionSchema } from '../cms.types';
import { image, link, list, number, text, textarea, toggle, video } from './fields';

const hero: SectionSchema = {
  type: 'eventsHero', label: 'Event page banners', icon: 'image', fixed: true, single: true, canDisable: false,
  description: 'Manage the rotating banners shown at the top of the Events page.',
  fields: [
    list('banners', 'Banners', 'Banner', 10, [
      text('eyebrow', 'Eyebrow', 80), text('title', 'Title', 140, { required: true }),
      text('subtitle', 'Subtitle', 180), textarea('description', 'Description', 400),
      image('image', 'Banner image', { required: true, aspect: '16:7', help: 'Used as the banner background and as the fallback/poster when a video is added.' }),
      video('video', 'Optional banner video', { help: 'Upload or select a short landscape video. It plays muted and loops behind the banner text.' }),
      link('cta', 'Banner button'),
      toggle('visible', 'Visible'),
    ], { required: true }),
  ],
};

const categories: SectionSchema = {
  type: 'eventsCategories', label: 'Explore by category', icon: 'grid-2x2', fixed: true, single: true, canDisable: false,
  description: 'Edit the category section heading, order, labels and images. Event counts remain live.',
  fields: [
    text('heading', 'Heading', 100, { required: true }), textarea('description', 'Description', 240),
    list('categories', 'Categories', 'Category', 12, [
      text('category', 'Catalogue category', 80, { required: true }), text('label', 'Display label', 80),
      textarea('description', 'Card description', 140),
      image('image', 'Card image', { aspect: '4:5', help: 'Shown normally and used as the poster/fallback for the hover video.' }),
      video('video', 'Optional hover video', { help: 'Plays muted and loops while a visitor hovers or focuses this category card.' }),
      toggle('visible', 'Visible'),
    ]),
  ],
};

const happeningSoon: SectionSchema = {
  type: 'eventsHappeningSoon', label: 'Happening soon', icon: 'calendar-clock', fixed: true, single: true, canDisable: false,
  description: 'Control the heading and number of cards in the upcoming-events row. Cards come from live event dates.',
  fields: [
    text('heading', 'Heading', 100, { required: true }), textarea('description', 'Description', 240),
    number('limit', 'Maximum cards', 1, 12), toggle('showViewAll', 'Show View all link'),
  ],
};

const trendingCities: SectionSchema = {
  type: 'eventsTrendingCities', label: 'Trending cities', icon: 'map-pin', fixed: true, single: true, canDisable: false,
  description: 'Choose and order the city rows displayed on the Events page. Their cards and prices remain live.',
  fields: [
    list('cities', 'Trending city sections', 'City', 10, [
      text('city', 'Catalogue city', 100, { required: true }), text('heading', 'Custom heading', 120),
      textarea('description', 'Custom description', 240), number('limit', 'Maximum cards', 1, 12),
      toggle('showViewAll', 'Show View all link'), toggle('visible', 'Visible'),
    ]),
  ],
};

export const EVENTS_SECTION_SCHEMAS = [hero, categories, happeningSoon, trendingCities];
export const PAGE_EVENTS_SCHEMA: DocumentSchema = {
  key: 'page.events', label: 'Event Page', description: 'Manage banners and merchandising sections on the customer-facing Events page.',
  kind: 'page', previewPath: '/events',
  sections: { allowed: EVENTS_SECTION_SCHEMAS.map((section) => section.type), default: EVENTS_SECTION_SCHEMAS.map((section) => section.type) },
};
