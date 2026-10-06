import {
  breachedFilter,
  canCustomerClose,
  canCustomerReopen,
  computeSla,
  formatTicketNumber,
  parseTicketNumber,
  planStaffStatusChange,
  statusAfterCustomerMessage,
} from './tickets.rules';

describe('ticket numbering', () => {
  it('pads to six digits and grows past that', () => {
    expect(formatTicketNumber(1)).toBe('TKT-000001');
    expect(formatTicketNumber(42)).toBe('TKT-000042');
    expect(formatTicketNumber(1234567)).toBe('TKT-1234567');
  });

  it('parses numbers back and rejects junk', () => {
    expect(parseTicketNumber('TKT-000042')).toBe(42);
    expect(parseTicketNumber(' tkt-7 ')).toBe(7);
    expect(parseTicketNumber('ORD-000042')).toBeNull();
    expect(parseTicketNumber('TKT-')).toBeNull();
  });
});

describe('status rules', () => {
  it('rejects no-op changes', () => {
    expect(planStaffStatusChange('open', 'open')).toMatchObject({ ok: false, code: 'NO_CHANGE' });
  });

  it('sets resolvedAt when resolving and clears both when reopening', () => {
    expect(planStaffStatusChange('open', 'resolved')).toEqual({
      ok: true,
      plan: { status: 'resolved', resolvedAt: 'set', closedAt: 'clear' },
    });
    expect(planStaffStatusChange('resolved', 'open')).toEqual({
      ok: true,
      plan: { status: 'open', resolvedAt: 'clear', closedAt: 'clear' },
    });
  });

  it('keeps the resolved time when a resolved ticket is closed, sets it when closing directly', () => {
    expect(planStaffStatusChange('resolved', 'closed')).toMatchObject({ plan: { resolvedAt: 'keep', closedAt: 'set' } });
    expect(planStaffStatusChange('pending', 'closed')).toMatchObject({ plan: { resolvedAt: 'set', closedAt: 'set' } });
  });

  it('brings customer replies back to open except on closed tickets', () => {
    expect(statusAfterCustomerMessage('pending')).toBe('open');
    expect(statusAfterCustomerMessage('resolved')).toBe('open');
    expect(statusAfterCustomerMessage('closed')).toBeNull();
  });

  it('limits customer close and reopen', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    expect(canCustomerClose('open')).toBe(true);
    expect(canCustomerClose('closed')).toBe(false);
    expect(canCustomerReopen('open', null, now)).toBe(false);
    expect(canCustomerReopen('resolved', null, now)).toBe(true);
    expect(canCustomerReopen('closed', new Date('2026-10-01T00:00:00Z'), now)).toBe(true);
    expect(canCustomerReopen('closed', new Date('2026-09-01T00:00:00Z'), now)).toBe(false);
  });
});

describe('SLA computation', () => {
  const targets = { firstResponseHours: 4, resolutionHours: 48 };
  const createdAt = new Date('2026-10-01T08:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('is pending inside both windows and reports the next deadline', () => {
    const sla = computeSla({ createdAt, status: 'open', targets, now: at('2026-10-01T09:00:00Z') });
    expect(sla).toMatchObject({ firstResponse: 'pending', resolution: 'pending', breached: false, dueSoon: false });
    expect(sla.nextDeadlineAt?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });

  it('flags due soon within the last hour', () => {
    const sla = computeSla({ createdAt, status: 'open', targets, now: at('2026-10-01T11:30:00Z') });
    expect(sla.dueSoon).toBe(true);
    expect(sla.breached).toBe(false);
  });

  it('breaches first response when unanswered past the target', () => {
    const sla = computeSla({ createdAt, status: 'open', targets, now: at('2026-10-01T12:01:00Z') });
    expect(sla).toMatchObject({ firstResponse: 'breached', breached: true });
  });

  it('is met when the first reply came in time, met_late when it did not (and not currently breached)', () => {
    const met = computeSla({ createdAt, firstResponseAt: at('2026-10-01T10:00:00Z'), status: 'pending', targets, now: at('2026-10-02T08:00:00Z') });
    expect(met).toMatchObject({ firstResponse: 'met', breached: false });
    const late = computeSla({ createdAt, firstResponseAt: at('2026-10-01T15:00:00Z'), status: 'pending', targets, now: at('2026-10-02T08:00:00Z') });
    expect(late).toMatchObject({ firstResponse: 'met_late', breached: false });
  });

  it('breaches resolution after the target while active', () => {
    const sla = computeSla({ createdAt, firstResponseAt: at('2026-10-01T09:00:00Z'), status: 'pending', targets, now: at('2026-10-03T08:01:00Z') });
    expect(sla).toMatchObject({ resolution: 'breached', breached: true, nextDeadlineAt: null });
  });

  it('stops the clock once resolved or closed', () => {
    const ok = computeSla({ createdAt, firstResponseAt: at('2026-10-01T09:00:00Z'), resolvedAt: at('2026-10-02T09:00:00Z'), status: 'resolved', targets, now: at('2026-12-01T00:00:00Z') });
    expect(ok).toMatchObject({ resolution: 'met', breached: false, nextDeadlineAt: null });
    const late = computeSla({ createdAt, firstResponseAt: at('2026-10-01T09:00:00Z'), resolvedAt: at('2026-10-05T09:00:00Z'), status: 'closed', targets, now: at('2026-12-01T00:00:00Z') });
    expect(late).toMatchObject({ resolution: 'met_late', breached: false });
    const unanswered = computeSla({ createdAt, status: 'closed', resolvedAt: at('2026-10-01T09:00:00Z'), targets, now: at('2026-12-01T00:00:00Z') });
    expect(unanswered.firstResponse).toBe('n/a');
  });

  it('builds a breached filter from the targets', () => {
    const filter = breachedFilter(targets, at('2026-10-05T08:00:00Z')) as { $or: Record<string, unknown>[] };
    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[0]).toMatchObject({ createdAt: { $lt: at('2026-10-05T04:00:00Z') } });
    expect(filter.$or[1]).toMatchObject({ createdAt: { $lt: at('2026-10-03T08:00:00Z') } });
  });
});
