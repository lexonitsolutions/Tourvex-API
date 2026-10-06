import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateReviewDto, ListReviewsDto, ModerateReviewDto } from './reviews.dto';

function errors<T extends object>(cls: new () => T, value: Record<string, unknown>): string[] {
  const dto = plainToInstance(cls, value);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

describe('CreateReviewDto', () => {
  const valid = {
    bookingReference: 'TVX-2026-1A2B3C4D',
    rating: 5,
    title: 'Great day out',
    body: 'We had a lovely time and everything ran on schedule.',
  };

  it('accepts a valid review', () => {
    expect(errors(CreateReviewDto, valid)).toEqual([]);
  });

  it('enforces rating, title and body limits', () => {
    expect(errors(CreateReviewDto, { ...valid, rating: 0 })).toContain('rating');
    expect(errors(CreateReviewDto, { ...valid, rating: 6 })).toContain('rating');
    expect(errors(CreateReviewDto, { ...valid, rating: 4.5 })).toContain('rating');
    expect(errors(CreateReviewDto, { ...valid, title: 'x'.repeat(101) })).toContain('title');
    expect(errors(CreateReviewDto, { ...valid, body: 'too short' })).toContain('body');
    expect(errors(CreateReviewDto, { ...valid, body: 'x'.repeat(2001) })).toContain('body');
    expect(errors(CreateReviewDto, { ...valid, bookingReference: 'no way!' })).toContain('bookingReference');
  });

  it('does not let a client set status or images', () => {
    expect(errors(CreateReviewDto, { ...valid, status: 'published' })).toContain('status');
    expect(errors(CreateReviewDto, { ...valid, images: ['https://x.test/a.jpg'] })).toContain('images');
  });
});

describe('ModerateReviewDto', () => {
  it('allows only published or rejected', () => {
    expect(errors(ModerateReviewDto, { status: 'published' })).toEqual([]);
    expect(errors(ModerateReviewDto, { status: 'rejected' })).toEqual([]);
    expect(errors(ModerateReviewDto, { status: 'pending' })).toContain('status');
  });
});

describe('ListReviewsDto', () => {
  it('has defaults and parses query strings', () => {
    const dto = plainToInstance(ListReviewsDto, { rating: '5', withImages: 'true', sort: 'top', page: '2', limit: '5' });
    expect(validateSync(dto)).toEqual([]);
    expect(dto).toMatchObject({ rating: 5, withImages: true, sort: 'top', page: 2, limit: 5 });
    expect(plainToInstance(ListReviewsDto, {})).toMatchObject({ sort: 'recent', page: 1, limit: 10 });
  });

  it('rejects out-of-range filters', () => {
    expect(errors(ListReviewsDto, { rating: '6' })).toContain('rating');
    expect(errors(ListReviewsDto, { sort: 'oldest' })).toContain('sort');
    expect(errors(ListReviewsDto, { limit: '51' })).toContain('limit');
  });
});
