import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, short-lived preview tokens. A token is `base64url(JSON{k,l,e}).base64url(HMAC)` bound to one
 * document key + locale and an expiry. Anyone holding a valid token can read that DRAFT, so tokens
 * are only issued to staff with cms.read and expire after 15 minutes.
 */

export const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_LENGTH = 512;

export interface PreviewClaims {
  k: string;
  l: string;
  e: number;
}

const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** Derives the signing secret the way the audit IP salt is derived (dedicated secret, else the Clerk secret). */
export function derivePreviewSecret(configured: string | undefined, clerkSecret: string | undefined): string {
  return configured || `cms-preview:${clerkSecret ?? 'tourvex-cms-default'}`;
}

function signature(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(`cms-preview-v1.${payload}`).digest();
}

export function signPreviewToken(
  secret: string,
  key: string,
  locale: string,
  now: number = Date.now(),
  ttlMs: number = PREVIEW_TTL_MS,
): { token: string; expiresAt: number } {
  const claims: PreviewClaims = { k: key, l: locale, e: now + ttlMs };
  const payload = b64(JSON.stringify(claims));
  return { token: `${payload}.${b64(signature(secret, payload))}`, expiresAt: claims.e };
}

export type PreviewVerdict =
  | { valid: true; claims: PreviewClaims }
  | { valid: false; reason: 'malformed' | 'signature' | 'expired' | 'key' };

export function verifyPreviewToken(
  secret: string,
  token: unknown,
  key: string,
  locale: string,
  now: number = Date.now(),
): PreviewVerdict {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { valid: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: 'malformed' };
  const [payload, given] = parts;
  const expected = signature(secret, payload);
  let provided: Buffer;
  try {
    provided = Buffer.from(given, 'base64url');
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { valid: false, reason: 'signature' };
  }
  let claims: PreviewClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PreviewClaims;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (typeof claims?.k !== 'string' || typeof claims.l !== 'string' || typeof claims.e !== 'number') {
    return { valid: false, reason: 'malformed' };
  }
  if (claims.e <= now) return { valid: false, reason: 'expired' };
  if (claims.k !== key || claims.l !== locale) return { valid: false, reason: 'key' };
  return { valid: true, claims };
}
