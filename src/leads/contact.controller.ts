import { Body, Controller, Header, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalUserResolver } from '../auth/optional-user.resolver';
import { Public } from '../common/decorators/public.decorator';
import { CreateContactDto } from './dto/leads.dto';
import { LeadsService } from './leads.service';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(
    private readonly leads: LeadsService,
    private readonly optionalUser: OptionalUserResolver,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Contact form (5 per minute per IP). Creates a lead; consent is required.' })
  async create(@Body() dto: CreateContactDto, @Headers('authorization') authorization?: string) {
    // Honeypot: bots fill the hidden field. Pretend success, store nothing.
    if (dto.website && dto.website.trim() !== '') return { reference: 'received', status: 'received' };
    const userId = await this.optionalUser.resolveUserId(authorization);
    const created = await this.leads.createPublic({
      source: 'contact',
      name: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      subject: dto.subject,
      message: dto.message,
      ...(dto.activitySlug ? { catalog: { type: 'activity' as const, slug: dto.activitySlug } } : {}),
      userId,
    });
    return { reference: created.sourceRef, status: 'received' };
  }
}
