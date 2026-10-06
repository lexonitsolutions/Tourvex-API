import { Body, Controller, Header, Headers, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Model } from 'mongoose';
import { OptionalUserResolver } from '../auth/optional-user.resolver';
import { Activity } from '../catalog/schemas/activity.schema';
import { Public } from '../common/decorators/public.decorator';
import { CreateActivityEnquiryDto } from './dto/leads.dto';
import { LeadsService } from './leads.service';

/**
 * `POST /catalog/activities/:slug/enquiries`: for activities that cannot be booked online
 * (no options). Lives with the leads module so the catalog module stays untouched.
 */
@ApiTags('catalog')
@Controller('catalog/activities')
export class ActivityEnquiryController {
  constructor(
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    private readonly leads: LeadsService,
    private readonly optionalUser: OptionalUserResolver,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':slug/enquiries')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Enquire about an activity (10 per minute per IP). Creates a lead.' })
  async create(
    @Param('slug') slug: string,
    @Body() dto: CreateActivityEnquiryDto,
    @Headers('authorization') authorization?: string,
  ) {
    const activity = await this.activities
      .findOne({ slug, published: true })
      .select({ _id: 1, slug: 1, title: 1 })
      .lean<{ _id: { toString(): string }; slug: string; title?: { en?: string } }>()
      .exec();
    if (!activity) throw new NotFoundException('Activity not found');
    const userId = await this.optionalUser.resolveUserId(authorization);
    const created = await this.leads.createPublic({
      source: 'activity',
      name: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      message: dto.message,
      pax: dto.guests,
      travelDate: dto.preferredDate ? new Date(dto.preferredDate) : undefined,
      catalog: {
        type: 'activity',
        slug: activity.slug,
        id: activity._id.toString(),
        title: activity.title?.en,
      },
      userId,
    });
    return { reference: created.sourceRef, status: 'received' };
  }
}
