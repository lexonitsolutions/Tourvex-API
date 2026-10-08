/**
 * LOCAL DEVELOPMENT ONLY sign-in, so the admin can be used and tested on a developer machine without a Clerk login.
 *
 * It is accepted only when ALL of these hold:
 *  - NODE_ENV is exactly "development" (never test, never production),
 *  - DEV_AUTH_ENABLED=true is set explicitly (off by default; env validation refuses to boot with it in production),
 *  - the request comes from this machine (loopback address),
 *  - the bearer token is the fixed development token.
 * Anything else falls through to the normal Clerk verification, so production behaviour is unchanged.
 */
export const DEV_AUTH_TOKEN = 'dev-local-admin';
export const DEV_AUTH_CLERK_ID = 'dev_local_admin';
export const DEV_AUTH_EMAIL = 'dev.admin@tourvex.local';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface DevAuthSettings {
  nodeEnv?: string;
  enabled?: string;
}

export function isDevAuthAvailable({ nodeEnv, enabled }: DevAuthSettings): boolean {
  return nodeEnv === 'development' && enabled === 'true';
}

/** True when this request should be treated as the local development administrator. */
export function acceptsDevAuth(settings: DevAuthSettings, token: string, remoteAddress: string | undefined): boolean {
  return isDevAuthAvailable(settings) && token === DEV_AUTH_TOKEN && !!remoteAddress && LOOPBACK.has(remoteAddress);
}
