import type { DocumentSchema, SectionSchema } from '../cms.types';
import { image, link, list, text, textarea, toggle, video } from './fields';

const hero: SectionSchema = {
  type: 'holidaysHero', label: 'Holiday banners', icon: 'image', fixed: true, single: true, canDisable: true,
  description: 'Create, reorder and hide the banners at the top of the Holidays page.',
  fields: [list('banners', 'Banners', 'Banner', 10, [
    text('title', 'Title', 140, { required: true }), text('subtitle', 'Subtitle', 200),
    image('image', 'Banner image', { required: true, aspect: '16:7' }), video('video', 'Optional banner video'),
    link('cta', 'Banner button'), toggle('visible', 'Visible'),
  ])],
};

const catalogueRail = (type: string, label: string, noun: string): SectionSchema => ({
  type, label, icon: 'layout-list', fixed: true, single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 260),
    toggle('show', `Show ${noun}`), list('items', 'Card overrides', 'Card', 30, [
      text('name', 'Catalogue city or country name', 120, { required: true }),
      text('label', 'Display label', 120),
      image('image', 'Card image', { aspect: '4:3', help: 'Card photo or video poster.' }),
      video('video', 'Optional card video', { help: 'If added, this video will be displayed instead of the static image.' }),
      toggle('visible', 'Visible'),
    ], { help: 'Leave empty to show every live catalogue card. Add cards to choose, reorder, rename or replace their images or videos.' }),
    toggle('showViewAll', 'Show View all link')],
});

const packages: SectionSchema = {
  type: 'holidaysPackages', label: 'Featured holiday packages', icon: 'star', fixed: true, single: true, canDisable: true,
  description: 'Choose exactly which live catalogue packages are shown, and in which order.',
  fields: [text('heading', 'Heading', 120, { required: true }), textarea('description', 'Description', 260),
    list('packages', 'Holiday packages', 'Package', 24, [
      text('packageId', 'Package ID', 60), text('slug', 'Package slug', 120, { required: true }),
      text('title', 'Package title', 160, { required: true }), image('image', 'Card image', { aspect: '4:3' }),
      text('country', 'Country / destination', 120), text('duration', 'Duration', 60), text('price', 'Price', 60),
    ]), toggle('showViewAll', 'Show View all link')],
};

const why: SectionSchema = {
  type: 'holidaysWhy', label: 'Why book with us', icon: 'sparkles', fixed: true, single: true, canDisable: true,
  fields: [text('heading', 'Heading', 120, { required: true }), list('items', 'Benefits', 'Benefit', 8, [
    text('title', 'Title', 100, { required: true }), textarea('description', 'Description', 300, { required: true }),
    image('image', 'Optional image', { aspect: '4:3' }), toggle('visible', 'Visible'),
  ]), link('cta', 'Button')],
};

export const HOLIDAYS_SECTION_SCHEMAS = [hero,
  catalogueRail('holidaysRecent', 'Recently viewed', 'recently viewed packages'),
  catalogueRail('holidaysCities', 'Destination cities', 'city cards'),
  catalogueRail('holidaysCountries', 'Destination countries', 'country cards'), packages, why];

export const PAGE_HOLIDAYS_SCHEMA: DocumentSchema = {
  key: 'page.holidays', label: 'Holiday Page', description: 'Manage every section, banner, image and featured package on the Holidays page.',
  kind: 'page', previewPath: '/holidays',
  sections: { allowed: HOLIDAYS_SECTION_SCHEMAS.map((s) => s.type), default: HOLIDAYS_SECTION_SCHEMAS.map((s) => s.type) },
};
