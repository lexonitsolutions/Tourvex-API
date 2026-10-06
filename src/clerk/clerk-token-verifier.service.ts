import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { ClerkService } from './clerk.service';

export const UNAUTHORIZED_MESSAGE = 'Authentication required';

interface SessionClaims {
  sub?: unknown;
}

/** Single place that turns an `Authorization` header into a verified Clerk user id. */
@Injectable()
export class ClerkTokenVerifier {
  private readonly logger = new Logger(ClerkTokenVerifier.name);

  constructor(private readonly clerk: ClerkService) {}

  get isConfigured(): boolean {
    return this.clerk.isConfigured;
  }

  extractBearerToken(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const [scheme, token] = header.trim().split(/\s+/);
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }

  /**
   * The public `verifyToken` resolves to the JWT payload and THROWS a TokenVerificationError on any
   * failure (expired, bad signature, wrong azp, ...). Its payload type lives in
   * `@clerk/shared/types`, which this project's CommonJS resolution cannot see, so the payload is
   * read through the local SessionClaims shape. Throws a generic 401 on any failure.
   */
  async verify(token: string): Promise<string> {
    let payload: SessionClaims;
    try {
      payload = await verifyToken(token, {
        secretKey: this.clerk.secretKey,
        authorizedParties: this.clerk.authorizedParties,
      });
    } catch (error) {
      // `reason` is a fixed Clerk code such as "token-expired"; never log the token or message.
      const reason = (error as { reason?: unknown } | null)?.reason;
      this.logger.debug(
        `Rejected session token: ${typeof reason === 'string' ? reason : 'invalid'}`,
      );
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }
    if (typeof payload?.sub !== 'string' || !payload.sub) {
      this.logger.debug('Rejected session token: no subject');
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }
    return payload.sub;
  }
}
