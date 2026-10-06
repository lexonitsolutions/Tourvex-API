import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditService, normalizeRequestId } from './audit.service';
import type { FieldChange } from './redact';

export const AUDITED_KEY = 'audited';
export interface AuditedMeta {
  entityType: string;
  action: string;
}

/** Marks an admin mutation to be audited after it succeeds. Pair with `@UseInterceptors(AuditInterceptor)`. */
export const Audited = (entityType: string, action: string) =>
  SetMetadata(AUDITED_KEY, { entityType, action } satisfies AuditedMeta);

export interface AuditContext {
  entityId?: string;
  summary?: string;
  changes?: FieldChange[];
}

type AuditedRequest = Request & {
  user?: { sub: string; email: string; roles: string[] };
  auditContext?: AuditContext;
};

/** Lets a handler enrich its audit entry with real before/after changes and a summary. */
export function setAuditContext(request: object, context: AuditContext): void {
  (request as AuditedRequest).auditContext = context;
}

/**
 * Records an entry for every SUCCESSFUL call of an @Audited handler. Errors are not logged
 * (a guard 403 never reaches an interceptor either). Without an explicit context the entity id
 * comes from `:id` or the response `id`, and `changes` from the request body keys.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditedMeta | undefined>(AUDITED_KEY, context.getHandler());
    if (!meta || context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuditedRequest>();

    return next.handle().pipe(
      tap((body) => {
        const actor = request.user;
        if (!actor) return;
        const supplied = request.auditContext;
        const params = request.params as Record<string, string | undefined>;
        const responseId = (body as { id?: unknown } | null | undefined)?.id;
        const entityId =
          supplied?.entityId ?? params.id ?? (typeof responseId === 'string' ? responseId : undefined);
        const bodyChanges: FieldChange[] = Object.entries(
          (request.body as Record<string, unknown> | undefined) ?? {},
        ).map(([field, to]) => ({ field, from: null, to }));
        void this.audit.record({
          actor,
          action: meta.action,
          entityType: meta.entityType,
          entityId,
          summary:
            supplied?.summary ?? `${meta.action} ${meta.entityType}${entityId ? ` ${entityId}` : ''}`,
          changes: supplied?.changes ?? bodyChanges,
          ip: request.ip,
          requestId: normalizeRequestId(request.headers['x-request-id']),
        });
      }),
    );
  }
}
