import { Types } from 'mongoose';
import { adminCatalogFilter, planCreateAudit, planDeleteAudit, planUpdateAudit, toAdminRecord } from './admin-catalog';

describe('adminCatalogFilter', () => {
  it('is empty without filters', () => {
    expect(adminCatalogFilter({})).toEqual({});
  });

  it('narrows by published and sample', () => {
    expect(adminCatalogFilter({ published: false })).toEqual({ published: false });
    expect(adminCatalogFilter({ sample: true })).toEqual({ isSample: true });
    expect(adminCatalogFilter({ sample: false })).toEqual({ isSample: { $ne: true } });
  });
});

describe('toAdminRecord', () => {
  it('maps _id to id, drops __v and sub-document ids, and ISO-formats dates', () => {
    const id = new Types.ObjectId();
    const at = new Date('2026-01-02T03:04:05.000Z');
    const record = toAdminRecord({
      _id: id,
      __v: 0,
      slug: 'a',
      sessions: [{ _id: new Types.ObjectId(), startsAt: at }],
      createdAt: at,
      updatedAt: at,
    });
    expect(record).toEqual({
      id: String(id),
      slug: 'a',
      sessions: [{ startsAt: at.toISOString() }],
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      published: false,
      isSample: false,
    });
  });
});

describe('audit planning', () => {
  const before = { id: 'x1', title: 'Old', published: false, summary: 's' };

  it('plans a plain update without a publish entry', () => {
    const entries = planUpdateAudit('holiday', before, { title: 'New' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'holiday.update', entityId: 'x1' });
    expect(entries[0].changes).toEqual([{ field: 'title', from: 'Old', to: 'New' }]);
  });

  it('plans a distinct publish entry when only published changes', () => {
    const entries = planUpdateAudit('cruise', before, { published: true });
    expect(entries.map((e) => e.action)).toEqual(['cruise.publish']);
    expect(planUpdateAudit('cruise', { ...before, published: true }, { published: false })[0].action).toBe(
      'cruise.unpublish',
    );
  });

  it('plans both entries when published and other fields change', () => {
    const entries = planUpdateAudit('event', before, { title: 'New', published: true });
    expect(entries.map((e) => e.action)).toEqual(['event.update', 'event.publish']);
    expect(entries[0].changes).toEqual([{ field: 'title', from: 'Old', to: 'New' }]);
  });

  it('does not treat an unchanged published value as a publish', () => {
    const entries = planUpdateAudit('visa', before, { published: false, summary: 's' });
    expect(entries.map((e) => e.action)).toEqual(['visa.update']);
  });

  it('plans create and delete entries', () => {
    expect(planCreateAudit('visa', { id: 'v1', title: 'T' }, { title: 'T' })).toMatchObject({
      action: 'visa.create',
      entityId: 'v1',
      changes: [{ field: 'title', from: null, to: 'T' }],
    });
    expect(planDeleteAudit('visa', { id: 'v1', title: 'T' })).toMatchObject({ action: 'visa.delete', entityId: 'v1' });
  });
});
