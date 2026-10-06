import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ClerkClient, createClerkClient } from '@clerk/backend';

/**
 * Holds the Clerk configuration and a single Backend API client for the process.
 * Never log the secret key; only whether it is configured.
 */
@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  readonly secretKey: string | undefined;
  readonly authorizedParties: string[];
  private clerkClient?: ClerkClient;

  constructor(config: ConfigService) {
    this.secretKey = config.get<string>('CLERK_SECRET_KEY')?.trim() || undefined;
    const configured = config.get<string>('CLERK_AUTHORIZED_PARTIES')?.trim();
    if (configured === '*' && config.get<string>('NODE_ENV') === 'test') {
      // An empty list makes Clerk skip the azp check (test runs with Backend-API-minted tokens).
      this.authorizedParties = [];
      this.logger.warn('CLERK_AUTHORIZED_PARTIES=*: the session token azp check is disabled.');
    } else {
      this.authorizedParties = (
        configured && configured !== '*'
          ? configured
          : config.get<string>('FRONTEND_URL', 'http://localhost:3000')
      )
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean);
      if (this.authorizedParties.length === 0) {
        throw new Error('Set CLERK_AUTHORIZED_PARTIES or FRONTEND_URL to the website origin(s)');
      }
    }

    if (!this.secretKey) {
      this.logger.warn(
        'CLERK_SECRET_KEY is not set: every protected route will answer 401 until it is configured.',
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  get client(): ClerkClient {
    if (!this.secretKey) throw new Error('Clerk is not configured');
    this.clerkClient ??= createClerkClient({ secretKey: this.secretKey });
    return this.clerkClient;
  }
}
