import { plainToInstance, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @IsInt()
  @Min(1)
  @Type(() => Number)
  PORT = 4000;

  @IsString()
  API_PREFIX = 'api/v1';

  @IsString()
  FRONTEND_URL = 'http://localhost:3000';

  @IsNotEmpty()
  MONGODB_URI!: string;

  /** Redis for the shared public-data cache. Optional: without it (or when unreachable) an in-memory cache is used. */
  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  /**
   * LOCAL DEVELOPMENT ONLY: `true` lets the admin sign in without Clerk from this machine (see auth/dev-auth.ts). It only takes
   * effect when NODE_ENV=development, and the API refuses to start with it enabled in production.
   */
  @IsOptional()
  @IsBooleanString()
  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV === 'production')
  @Matches(/^(?!true$)/i, { message: 'DEV_AUTH_ENABLED must not be true when NODE_ENV=production' })
  DEV_AUTH_ENABLED?: string;

  /** `false` turns the read cache off. Defaults to on, except when NODE_ENV=test. */
  @IsOptional()
  @IsBooleanString()
  CACHE_ENABLED?: string;

  /** Clerk Backend API secret key. Required in production; without it protected routes answer 401. */
  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV === 'production')
  @IsString()
  @IsNotEmpty({ message: 'CLERK_SECRET_KEY is required when NODE_ENV=production' })
  CLERK_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  CLERK_PUBLISHABLE_KEY?: string;

  /**
   * Comma-separated origins allowed in the session token `azp` claim. Defaults to FRONTEND_URL.
   * `*` disables the azp check and is accepted ONLY when NODE_ENV=test (Backend-API-minted test
   * session tokens carry no azp claim).
   */
  @IsOptional()
  @IsString()
  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV !== 'test')
  @Matches(/^(?!\s*\*\s*$)/, {
    message: 'CLERK_AUTHORIZED_PARTIES=* is only allowed when NODE_ENV=test',
  })
  CLERK_AUTHORIZED_PARTIES?: string;

  /** Secret salt for hashing caller IPs in the admin audit log (set a long random value in production). */
  @IsOptional()
  @IsString()
  AUDIT_IP_SALT?: string;

  @IsOptional()
  @IsString()
  STRIPE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_SECRET?: string;

  /** Publishable key presence only drives `publishableKeyConfigured`; the key is never returned. */
  @IsOptional()
  @IsString()
  STRIPE_PUBLISHABLE_KEY?: string;

  @IsBooleanString()
  PAYMENTS_MOCK = 'true';

  /** Percent shown as "Taxes & fees" and included in every activity total (0-30). */
  @IsNumber()
  @Min(0)
  @Max(30)
  @Type(() => Number)
  CHECKOUT_TAX_PERCENT = 5;

  /** Minutes a cart (and its capacity holds) lasts; restarts when the cart changes. */
  @IsInt()
  @Min(1)
  @Max(120)
  @Type(() => Number)
  CHECKOUT_HOLD_MINUTES = 10;

  /** Seconds between sweeps that expire unpaid carts (the timer is disabled when NODE_ENV=test). */
  @IsInt()
  @Min(5)
  @Type(() => Number)
  CHECKOUT_SWEEP_SECONDS = 60;

  /** Show ORIGINAL SAMPLE activity details/options and sample promo codes in production. */
  @IsOptional()
  @IsBooleanString()
  ACTIVITY_SAMPLE_DETAILS?: string;

  @IsBooleanString()
  SUPPLIERS_MOCK = 'true';

  @IsOptional()
  @IsBooleanString()
  HOLIDAYS_ALLOW_SAMPLES?: string;

  @IsOptional()
  @IsBooleanString()
  VISAS_ALLOW_SAMPLES?: string;

  @IsOptional()
  @IsBooleanString()
  CRUISES_ALLOW_SAMPLES?: string;

  @IsOptional()
  @IsBooleanString()
  EVENTS_ALLOW_SAMPLES?: string;

  @IsOptional()
  @IsBooleanString()
  PARTNERS_ALLOW_SAMPLES?: string;

  /**
   * Comma-separated e-mail addresses that receive low-stock and sold-out alerts. When empty, the support e-mail from the
   * admin settings is used; when that is empty too, no alert e-mail is sent (alerts still appear in the admin).
   */
  @IsOptional()
  @IsString()
  @Matches(/^\s*$|^\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+)*\s*,?\s*$/, {
    message: 'STOCK_ALERT_EMAILS must be comma-separated e-mail addresses',
  })
  STOCK_ALERT_EMAILS?: string;

  /** Exchange-rate source; must return { result:"success", base_code:"AED", rates, time_last_update_unix }. */
  @IsUrl({ require_tld: false, require_protocol: true })
  FX_API_URL = 'https://open.er-api.com/v6/latest/AED';

  /** Optional provider key; substituted into a `{key}` placeholder in FX_API_URL when present. */
  @IsOptional()
  @IsString()
  FX_API_KEY?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  FX_REFRESH_HOURS = 6;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  FX_MAX_AGE_HOURS = 72;

  /** Percent added to non-AED conversions (0-10). */
  @IsNumber()
  @Min(0)
  @Max(10)
  @Type(() => Number)
  FX_MARKUP_PERCENT = 0;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  return validated;
}
