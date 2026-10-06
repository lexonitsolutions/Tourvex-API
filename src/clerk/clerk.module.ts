import { Global, Module } from '@nestjs/common';
import { ClerkTokenVerifier } from './clerk-token-verifier.service';
import { ClerkService } from './clerk.service';

@Global()
@Module({
  providers: [ClerkService, ClerkTokenVerifier],
  exports: [ClerkService, ClerkTokenVerifier],
})
export class ClerkModule {}
