import type { DocumentSchema, SectionSchema } from '../cms.types';
import { image, link, list, text, textarea, toggle, video } from './fields';

const hero: SectionSchema = {
  type: 'voyagerHero', label: 'Voyager banners', icon: 'image', fixed: true, single: true, canDisable: true,
  fields: [list('banners', 'Banners', 'Banner', 10, [
    text('title', 'Title', 140, { required: true }), text('subtitle', 'Subtitle', 200),
    image('image', 'Banner image', { required: true, aspect: '16:7' }), video('video', 'Optional banner video'),
    link('cta', 'Banner button'), toggle('visible', 'Visible'),
  ])],
};
const rail = (type: string, label: string): SectionSchema => ({ type, label, icon: 'layout-list', fixed: true, single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 260), toggle('show', 'Show this catalogue section'),
    list('items', 'Card overrides', 'Card', 30, [
      text('name', 'Catalogue city or country name', 120, { required: true }),
      text('label', 'Display label', 120),
      image('image', 'Card image', { aspect: '4:3', help: 'Card photo or video poster.' }),
      video('video', 'Optional card video', { help: 'If added, this video will be displayed instead of the static image.' }),
      toggle('visible', 'Visible'),
    ],
      { help: 'Leave empty to show every live catalogue card. Add cards to choose, reorder, rename or replace their images or videos.' })] });
const departureCities: SectionSchema = {
  type: 'voyagerCities',
  label: 'Departure cities',
  icon: 'layout-list',
  fixed: true,
  single: true,
  canDisable: true,
  description: 'Choose cruises from the catalogue and arrange the cards shown in this section.',
  fields: [
    text('heading', 'Heading', 120, { required: true }),
    textarea('description', 'Description', 260),
    toggle('show', 'Show this catalogue section'),
    list('items', 'Departure cities', 'City', 30, [
      text('name', 'Catalogue city name', 120, { required: true }),
      text('label', 'Display label', 120),
      image('image', 'Card image', { aspect: '4:3' }),
      video('video', 'Optional card video'),
      toggle('visible', 'Visible'),
    ], { help: 'Choose existing cruises from Catalog → Cruises, then reorder or remove them here.' }),
  ],
};
const yachts: SectionSchema = {
  type: 'voyagerYachts',
  label: 'Luxury yachts and charters',
  icon: 'anchor',
  fixed: true,
  single: true,
  canDisable: true,
  description: 'Choose which saved yacht and charter packages appear and drag them into the desired order.',
  fields: [
    text('heading', 'Heading', 120, { required: true }),
    textarea('description', 'Description', 260),
    toggle('show', 'Show this section'),
    list('yachts', 'Yacht packages', 'Yacht', 24, [
      text('slug', 'Yacht slug', 120, { required: true }),
      text('title', 'Yacht title', 160, { required: true }),
      image('image', 'Card image', { aspect: '4:3' }),
      text('category', 'Category', 80),
      text('capacity', 'Capacity', 80),
      text('duration', 'Duration', 60),
      text('price', 'Price', 60),
      text('destination', 'Destination / Departure', 100),
      textarea('description', 'Short description', 260),
    ], { help: 'Select yacht packages to highlight on the page.' }),
    toggle('showViewAll', 'Show View all link'),
  ],
};
const cruises: SectionSchema = { type: 'voyagerCruises', label: 'Featured voyages', icon: 'ship', fixed: true, single: true, canDisable: true,
  description: 'Choose which live cruise packages appear and drag them into the desired order.', fields: [
    text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 260),
    list('cruises', 'Voyage packages', 'Voyage', 24, [text('cruiseId', 'Cruise ID', 60), text('slug', 'Cruise slug', 120, { required: true }),
      text('title', 'Cruise title', 160, { required: true }), image('image', 'Card image', { aspect: '4:3' }),
      text('departureCity', 'Departure city', 120), text('duration', 'Duration', 60), text('price', 'Fare', 60)]),
    toggle('showViewAll', 'Show View all link')], };
const promise: SectionSchema = { type: 'voyagerPromise', label: 'Our commitment', icon: 'sparkles', fixed: true, single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), list('items', 'Commitments', 'Commitment', 8, [
    text('title', 'Title', 100, { required: true }), textarea('description', 'Description', 300, { required: true }), toggle('visible', 'Visible')])], };
const cta: SectionSchema = { type: 'voyagerCta', label: 'Call to action', icon: 'megaphone', fixed: true, single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 300), image('image', 'Background image', { aspect: '16:6' }), link('cta', 'Button')] };

export const VOYAGER_SECTION_SCHEMAS = [hero, departureCities, rail('voyagerCountries', 'Destination countries'), yachts, cruises, promise, cta];
export const PAGE_VOYAGER_SCHEMA: DocumentSchema = { key: 'page.voyager', label: 'Voyager Page', description: 'Manage every section, banner, image and featured voyage on the Cruises/Voyager page.', kind: 'page', previewPath: '/cruises',
  sections: { allowed: VOYAGER_SECTION_SCHEMAS.map((s) => s.type), default: VOYAGER_SECTION_SCHEMAS.map((s) => s.type) } };
