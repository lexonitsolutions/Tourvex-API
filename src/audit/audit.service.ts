import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { buildPagination, escapeRegex, parseSort, skipFor } from '../common/query/paging-query.dto';
import { AuditLog } from './audit.schema';
import { ListAuditDto } from './dto/list-audit.dto';
import { type FieldChange, redactChanges } from './redact';

export interface AuditActor {
  /** Local user id. */
  sub: string;
  email: string;
  roles: string[];
}

export interface AuditRecordInput {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string;
  summary?: string;
  changes?: readonly FieldChange[];
  /** Raw caller IP; stored only as a salted hash. */
  ip?: string;
  requestId?: string;
}

const AUDIT_SORTS = ['at'] as const;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function hashIp(ip: string | undefined, salt: string): string | undefined {
  if (!ip) return undefined;
  return createHmac('sha256', salt).update(ip).digest('hex');
}

/** Accepts a sane client-supplied correlation id, otherwise generates one. */
export function normalizeRequestId(header: unknown): string {
  const value: unknown = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value)) return value;
  return randomUUID();
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly salt: string;

  constructor(
    @InjectModel(AuditLog.name) private readonly logs: Model<AuditLog>,
    config: ConfigService,
  ) {
    // AUDIT_IP_SALT is the intended secret; otherwise derive one from the Clerk secret so hashes
    // stay unguessable even when it is not configured.
    this.salt =
      config.get<string>('AUDIT_IP_SALT') ||
      `audit:${config.get<string>('CLERK_SECRET_KEY') ?? 'tourvex-audit-default'}`;
  }

  /**
   * Writes one entry. Never throws: the audited mutation has already happened, so a logging
   * failure goes to the server log instead of turning a successful change into an error.
   */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.logs.create({
        at: new Date(),
        actorId: new Types.ObjectId(input.actor.sub),
        actorEmail: input.actor.email,
        actorRoles: input.actor.roles,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: (input.summary ?? '').slice(0, 300),
        changes: input.changes ? redactChanges(input.changes) : [],
        ip: hashIp(input.ip, this.salt),
        requestId: input.requestId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${input.action} ${input.entityType}: ${(error as Error).message}`,
      );
    }
  }

  async list(query: ListAuditDto) {
    const filter: Record<string, any> = {};
    if (query.actor) {
      if (OBJECT_ID.test(query.actor)) filter.actorId = new Types.ObjectId(query.actor);
      else filter.actorEmail = query.actor.trim().toLowerCase();
    }
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.action) filter.action = query.action;
    if (query.from || query.to) {
      filter.at = {
        ...(query.from && { $gte: new Date(query.from) }),
        ...(query.to && { $lte: new Date(query.to) }),
      };
    }
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter.$or = [
        { summary: pattern },
        { actorEmail: pattern },
        { action: pattern },
        { entityId: pattern },
      ];
    }
    const sort = parseSort(query.sort, AUDIT_SORTS, { field: 'at', dir: -1 });
    const [items, total] = await Promise.all([
      this.logs
        .find(filter)
        .sort(sort)
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean()
        .exec(),
      this.logs.countDocuments(filter).exec(),
    ]);
    return {
      items: items.map((entry) => ({
        id: entry._id.toString(),
        at: entry.at,
        actorId: entry.actorId.toString(),
        actorEmail: entry.actorEmail,
        actorRoles: entry.actorRoles,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        changes: entry.changes,
        requestId: entry.requestId ?? null,
      })),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }
}
