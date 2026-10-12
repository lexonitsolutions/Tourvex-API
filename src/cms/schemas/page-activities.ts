import type { DocumentSchema, SectionSchema } from '../cms.types';
import { color, image, link, list, number, select, text, textarea, toggle, video } from './fields';

const hero: SectionSchema = {
  type: 'activitiesHero', label: 'Activities banner', icon: 'image', fixed: true, single: true, canDisable: false,
  description: 'The main Activities & Experiences banner, search copy and category shortcuts.',
  fields: [
    text('eyebrow', 'Eyebrow', 70, { required: true }), text('heading', 'Heading', 120, { required: true }),
    text('accent', 'Highlighted heading text', 50), textarea('description', 'Description', 280, { required: true }),
    image('image', 'Banner image', { required: true, aspect: '16:6' }),
    video('video', 'Banner video', { required: false, help: 'Optional looping background video. The banner image remains the poster and fallback.' }),
    color('overlay', 'Banner overlay colour'), number('overlayOpacity', 'Overlay opacity (%)', 0, 90),
    select('alignment', 'Text alignment', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }]),
    text('searchPlaceholder', 'Search placeholder', 100, { required: true }),
    link('cta', 'Optional banner button'),
    list('categories', 'Category shortcuts', 'Category', 12, [
      text('label', 'Label', 60, { required: true }), text('category', 'Catalogue category', 80, { help: 'Leave empty only for the All activities shortcut.' }),
      text('icon', 'Icon / emoji', 10), toggle('visible', 'Visible'),
    ]),
  ],
};

const filters: SectionSchema = {
  type: 'activitiesFilters', label: 'Filters and results', icon: 'sliders-horizontal', fixed: true, single: true, canDisable: false,
  description: 'Labels and available filter groups. Filter values continue to come from the live activity catalogue.',
  fields: [
    text('heading', 'Filters heading', 40, { required: true }), text('clearLabel', 'Clear filters label', 40, { required: true }),
    text('destinationLabel', 'Destination heading', 50, { required: true }), toggle('showDestination', 'Show destination filter'),
    text('categoryLabel', 'Category heading', 50, { required: true }), toggle('showCategory', 'Show category filter'),
    text('priceLabel', 'Price heading', 50, { required: true }), toggle('showPrice', 'Show price filter'),
    text('durationLabel', 'Duration heading', 50, { required: true }), toggle('showDuration', 'Show duration filter'),
    text('tripTypeLabel', 'Trip type heading', 50, { required: true }), toggle('showTripType', 'Show trip type filter'),
    text('offerLabel', 'Offer heading', 50, { required: true }), textarea('offerDescription', 'Offer description', 120), toggle('showOffers', 'Show offer filter'),
    text('sortLabel', 'Sort label', 40, { required: true }), text('resultsLabel', 'Results label', 80, { required: true, help: 'Use {count} and {noun}.' }),
    text('loadMoreLabel', 'Load more button', 60, { required: true, help: 'Use {count} for the remaining number.' }),
  ],
};

const featured: SectionSchema = {
  type: 'activitiesFeatured', label: 'Featured activities', icon: 'star', single: true, canDisable: true,
  description: 'Promote selected live catalogue activities without duplicating their prices or booking data.',
  fields: [
    text('heading', 'Heading', 100, { required: true }), textarea('description', 'Description', 220),
    list('activities', 'Featured catalogue activities', 'Activity', 12, [
      text('slug', 'Existing activity slug', 140, { required: true }), text('label', 'Promotional label', 40),
      toggle('visible', 'Visible'),
    ]),
  ],
};

const contentSection = (type: string, label: string, icon: string): SectionSchema => ({
  type, label, icon, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 500),
    image('image', 'Section image', { aspect: '16:9' }), link('cta', 'Optional button')],
});

const highlights: SectionSchema = {
  type: 'activitiesHighlights', label: 'Experience highlights', icon: 'sparkles', single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 300),
    list('items', 'Highlights', 'Highlight', 12, [text('icon', 'Icon / emoji', 10), text('title', 'Title', 80, { required: true }), textarea('description', 'Description', 220)])],
};

const gallery: SectionSchema = {
  type: 'activitiesGallery', label: 'Gallery', icon: 'images', single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 260),
    list('images', 'Gallery images', 'Image', 12, [image('image', 'Image', { required: true, aspect: '4:3' }), text('caption', 'Caption', 120)])],
};

const faqs: SectionSchema = {
  type: 'activitiesFaqs', label: 'Frequently asked questions', icon: 'circle-help', single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }),
    list('items', 'Questions', 'Question', 20, [text('question', 'Question', 180, { required: true }), textarea('answer', 'Answer', 1200, { required: true })])],
};

const promo = contentSection('activitiesPromo', 'Promotional section', 'badge-percent');
const cta = contentSection('activitiesCta', 'Call to action', 'megaphone');

export const ACTIVITIES_SECTION_SCHEMAS = [hero, filters, featured, promo, highlights, gallery, faqs, cta];
export const PAGE_ACTIVITIES_SCHEMA: DocumentSchema = {
  key: 'page.activities', label: 'Activities Page', description: 'Manage the customer-facing Activities & Experiences listing page.',
  kind: 'page', previewPath: '/activities',
  sections: { allowed: ACTIVITIES_SECTION_SCHEMAS.map((section) => section.type), default: ['activitiesHero', 'activitiesFilters', 'activitiesFeatured', 'activitiesHighlights', 'activitiesFaqs', 'activitiesCta'] },
};
