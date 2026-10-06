import { type ClassConstructor, plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  validateSync,
  ValidateNested,
  type ValidationArguments,
  type ValidationError,
} from 'class-validator';
import { appError } from '../../common/app-error';

export const SETTING_GROUPS = ['general', 'commerce', 'notifications', 'homepage', 'support'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export function isSettingGroup(value: string): value is SettingGroup {
  return (SETTING_GROUPS as readonly string[]).includes(value);
}

/** The only `{{placeholders}}` notification templates may contain. */
export const TEMPLATE_PLACEHOLDERS = [
  'bookingRef',
  'customerName',
  'serviceName',
  'travelDate',
  'totalAmount',
  'voucherUrl',
  'cancellationReason',
  'siteName',
  'supportEmail',
] as const;

/** Returns the placeholders in `text` that are not whitelisted (empty when the text is fine). */
export function unknownPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const name = match[1].trim();
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)) unknown.add(name);
  }
  return [...unknown];
}

/** Also rejects stray braces such as `{{ unterminated` that would leak into a sent email. */
function IsTemplateText(options: { max: number }) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isTemplateText',
      target: target.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          value.length <= options.max &&
          unknownPlaceholders(value).length === 0 &&
          !/\{\{|\}\}/.test(value.replace(/\{\{[^{}]*\}\}/g, '')),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be at most ${options.max} characters and may only use the placeholders: ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}`,
      },
    });
  };
}

const URL_OR_EMPTY = /^$|^https?:\/\/[^\s]{1,300}$/;
const URL_MESSAGE = 'must be empty or an http(s) URL';

export class SocialsDto {
  @IsOptional() @IsString() @Matches(URL_OR_EMPTY, { message: `facebook ${URL_MESSAGE}` })
  facebook?: string;

  @IsOptional() @IsString() @Matches(URL_OR_EMPTY, { message: `instagram ${URL_MESSAGE}` })
  instagram?: string;

  @IsOptional() @IsString() @Matches(URL_OR_EMPTY, { message: `x ${URL_MESSAGE}` })
  x?: string;

  @IsOptional() @IsString() @Matches(URL_OR_EMPTY, { message: `youtube ${URL_MESSAGE}` })
  youtube?: string;

  @IsOptional() @IsString() @Matches(URL_OR_EMPTY, { message: `linkedin ${URL_MESSAGE}` })
  linkedin?: string;

  @IsOptional() @IsString() @Matches(URL_OR_EMPTY, { message: `tiktok ${URL_MESSAGE}` })
  tiktok?: string;

  @IsOptional() @IsString() @Matches(URL_OR_EMPTY, { message: `whatsapp ${URL_MESSAGE}` })
  whatsapp?: string;
}

export class GeneralSettingsDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  siteName: string;

  @IsEmail() @MaxLength(120)
  supportEmail: string;

  @IsOptional() @IsString() @Matches(/^$|^[0-9+()\-.\s]{5,30}$/, { message: 'supportPhone must be a phone number' })
  supportPhone?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  /** Registered company name printed on invoices and credit notes. */
  @IsOptional() @IsString() @MaxLength(120)
  legalName?: string;

  /** TRN / VAT registration number printed on invoices. */
  @IsOptional() @IsString() @Matches(/^$|^[A-Za-z0-9][A-Za-z0-9 -/.]{3,29}$/, { message: 'taxNumber must be 4-30 letters, digits, spaces or - / .' })
  taxNumber?: string;

  @IsOptional() @ValidateNested() @Type(() => SocialsDto)
  socials?: SocialsDto;
}

export class CommerceSettingsDto {
  /** Percent shown as "Taxes & fees" on activity totals. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(30)
  taxPercent: number;

  /** Minutes a cart (and its capacity holds) lasts. */
  @IsInt() @Min(1) @Max(120)
  holdMinutes: number;

  /** Percent added to non-AED conversions. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10)
  fxMarkupPercent: number;

  /** Hours before the service start after which online booking closes (0 = no cutoff). Stored for the booking flow; not enforced yet. */
  @IsInt() @Min(0) @Max(720)
  bookingCutoffHours: number;
}

export class TemplateDto {
  @IsTemplateText({ max: 150 }) @IsNotEmpty()
  subject: string;

  @IsTemplateText({ max: 5000 }) @IsNotEmpty()
  body: string;
}

export class TemplatesDto {
  @ValidateNested() @Type(() => TemplateDto)
  bookingConfirmation: TemplateDto;

  @ValidateNested() @Type(() => TemplateDto)
  voucher: TemplateDto;

  @ValidateNested() @Type(() => TemplateDto)
  cancellation: TemplateDto;
}

export class NotificationSettingsDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  senderName: string;

  @ValidateNested() @Type(() => TemplatesDto)
  templates: TemplatesDto;
}

export class HomepageSectionDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, { message: 'id must be a lowercase slug' })
  id: string;

  @IsBoolean()
  enabled: boolean;
}

export class HomepageSettingsDto {
  /** Ordered: the array order is the render order. */
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => HomepageSectionDto)
  sections: HomepageSectionDto[];
}

/** Support ticket SLA targets (hours). */
export class SupportSettingsDto {
  @IsInt() @Min(1) @Max(168)
  firstResponseHours: number;

  @IsInt() @Min(1) @Max(2160)
  resolutionHours: number;
}

const GROUP_DTOS = {
  general: GeneralSettingsDto,
  commerce: CommerceSettingsDto,
  notifications: NotificationSettingsDto,
  homepage: HomepageSettingsDto,
  support: SupportSettingsDto,
} as const;

function flatten(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => `${path}: ${message}`);
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

/**
 * Validates a PUT body against its group's DTO (unknown keys are rejected) and returns a plain
 * object. Throws a 400 `{statusCode, code: 'VALIDATION_FAILED', message}`.
 */
export function validateSettings(group: SettingGroup, body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw appError(400, 'VALIDATION_FAILED', 'Body must be a JSON object');
  }
  const instance: object = plainToInstance(GROUP_DTOS[group] as ClassConstructor<object>, body);
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errors.length > 0) {
    throw appError(400, 'VALIDATION_FAILED', flatten(errors).slice(0, 10).join('; '));
  }
  if (group === 'homepage') {
    const ids = (instance as unknown as HomepageSettingsDto).sections.map((section) => section.id);
    if (new Set(ids).size !== ids.length) {
      throw appError(400, 'VALIDATION_FAILED', 'sections: ids must be unique');
    }
  }
  return JSON.parse(JSON.stringify(instance)) as Record<string, unknown>;
}
