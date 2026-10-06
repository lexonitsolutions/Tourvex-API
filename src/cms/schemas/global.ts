import type { DocumentSchema } from '../cms.types';
import { group, image, link, list, NAV_ICONS, richtext, select, text, textarea, toggle } from './fields';

export const GLOBAL_HEADER_SCHEMA: DocumentSchema = {
  key: 'global.header',
  label: 'Header and navigation',
  description: 'Logo, category tabs, search/help labels, the mobile tiles, bottom bar and the mega menu.',
  kind: 'global',
  previewPath: '/',
  fields: [
    image('logo', 'Logo', { required: true }),
    text('logoAriaLabel', 'Logo link label (screen readers)', 80, { required: true }),
    text('dockAriaLabel', 'Category tabs label (screen readers)', 80, { required: true }),
    list(
      'tabs',
      'Category tabs',
      'Tab',
      8,
      [
        link('link', 'Label and link', { required: true }),
        select('icon', 'Icon', NAV_ICONS, { required: true }),
        toggle('mega', 'Opens the mega menu on hover'),
        text('match', 'Highlight on these paths', 120, {
          help: 'Comma-separated path prefixes, e.g. /holidays,/tours. Empty = never highlighted.',
        }),
        toggle('mobileTile', 'Show as a tile on phones'),
      ],
      { min: 1 },
    ),
    group('search', 'Search pill', [
      richtext('markup', 'Text', 80, { required: true, help: 'Use **bold** for the emphasised word.' }),
      text('sparkle', 'Decorative symbol', 8),
      text('ariaLabel', 'Label (screen readers)', 120, { required: true }),
    ]),
    link('help', 'Help button', { required: true }),
    group('labels', 'Header buttons', [
      text('localeLabel', 'Language/currency button', 40, { required: true, help: 'Use {currency}.' }),
      text('localeAriaLabel', 'Language/currency button (screen readers)', 120, { required: true, help: 'Use {currency}.' }),
      text('accountAriaLabel', 'Account button (screen readers)', 80, { required: true }),
    ]),
    group('mobile', 'Phone navigation', [
      text('tilesAriaLabel', 'Tiles label (screen readers)', 80, { required: true }),
      text('moreLabel', '"More" tile', 40, { required: true }),
      text('sheetTitle', '"More" sheet title', 40, { required: true }),
      text('closeLabel', 'Close button (screen readers)', 40, { required: true }),
      text('localeRowLabel', 'Language and currency row', 60, { required: true }),
      list('moreLinks', '"More" sheet links', 'Link', 8, [
        link('link', 'Label and link', { required: true }),
        select('icon', 'Icon', NAV_ICONS, { required: true }),
      ]),
      text('tabBarAriaLabel', 'Bottom bar label (screen readers)', 80, { required: true }),
      list(
        'tabBarItems',
        'Bottom bar items',
        'Item',
        4,
        [
          link('link', 'Label and link', { required: true }),
          select(
            'icon',
            'Icon',
            [
              { value: 'home', label: 'Home' },
              { value: 'bookings', label: 'Ticket' },
              { value: 'wishlist', label: 'Heart' },
            ],
            { required: true },
          ),
        ],
        { min: 1 },
      ),
      text('accountTabLabel', 'Account tab', 40, { required: true }),
      text('smartSearchLabel', 'Smart search button (screen readers)', 60, { required: true }),
    ]),
    group('megaMenu', 'Mega menu', [
      text('regionAriaLabel', 'Menu label (screen readers)', 120, { required: true }),
      text('sidebarAriaLabel', 'Sidebar label (screen readers)', 80, { required: true }),
      list(
        'groups',
        'Menu groups',
        'Group',
        16,
        [
          text('icon', 'Emoji', 8, { required: true }),
          text('label', 'Group name', 80, { required: true }),
          list(
            'items',
            'Items',
            'Item',
            40,
            [
              link('link', 'Title and link', { required: true }),
              text('sub', 'Sub line', 80),
              image('image', 'Thumbnail', { required: true }),
            ],
            { min: 1 },
          ),
        ],
        { min: 1 },
      ),
      text('trendingLabel', 'Highlights bar title', 60, { required: true }),
      text('trendingTagline', 'Highlights bar tagline', 80, { required: true }),
      list('deals', 'Highlight cards', 'Card', 8, [
        link('link', 'Title and link', { required: true }),
        image('image', 'Thumbnail', { required: true }),
        text('badge', 'Badge', 40),
        text('rating', 'Rating', 20),
        text('oldPrice', 'Old price', 30),
        text('price', 'Price', 30, { required: true }),
      ]),
    ]),
  ],
};

export const GLOBAL_FOOTER_SCHEMA: DocumentSchema = {
  key: 'global.footer',
  label: 'Footer',
  description: 'About blurb, link columns, contact details, social links and the copyright line.',
  kind: 'global',
  previewPath: '/',
  fields: [
    image('logo', 'Logo', { required: true }),
    textarea('about', 'About blurb', 240, { required: true, rows: 3 }),
    list(
      'groups',
      'Link columns',
      'Column',
      6,
      [
        text('title', 'Column title', 60, { required: true }),
        list('links', 'Links', 'Link', 12, [link('link', 'Label and link', { required: true })], { min: 1 }),
      ],
      { min: 1 },
    ),
    group('contact', 'Contact details (shown under the blurb when filled in)', [
      text('phone', 'Phone', 40),
      text('email', 'Email', 120),
      textarea('address', 'Address', 240, { rows: 2 }),
      text('hours', 'Opening hours', 120),
    ]),
    list('socials', 'Social links', 'Link', 8, [
      select(
        'platform',
        'Network',
        [
          { value: 'facebook', label: 'Facebook' },
          { value: 'instagram', label: 'Instagram' },
          { value: 'x', label: 'X' },
          { value: 'youtube', label: 'YouTube' },
          { value: 'linkedin', label: 'LinkedIn' },
          { value: 'tiktok', label: 'TikTok' },
          { value: 'whatsapp', label: 'WhatsApp' },
        ],
        { required: true },
      ),
      link('link', 'Label and link', { required: true }),
    ]),
    text('copyright', 'Copyright line', 160, { required: true, help: 'Use {year} for the current year.' }),
  ],
};

export const GLOBAL_SEO_SCHEMA: DocumentSchema = {
  key: 'global.seo',
  label: 'SEO and site identity',
  description: 'Site name, default title and description, favicon, share image and per-page meta.',
  kind: 'global',
  previewPath: '/',
  fields: [
    text('siteName', 'Site name', 80, { required: true }),
    text('defaultTitle', 'Default page title', 120, { required: true }),
    textarea('defaultDescription', 'Default meta description', 300, { required: true, rows: 3 }),
    image('favicon', 'Favicon / app icon', { required: true }),
    image('ogImage', 'Default share image (social previews)'),
    group('pages', 'Per-page meta', [
      group('home', 'Home page', [
        text('title', 'Title', 120, { required: true }),
        textarea('description', 'Description', 300, { required: true, rows: 3 }),
      ]),
    ]),
  ],
};
