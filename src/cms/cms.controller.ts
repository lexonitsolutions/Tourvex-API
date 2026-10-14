import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { RequirePermission } from '../admin/require-permission.decorator';
import { Audited, AuditInterceptor, setAuditContext } from '../audit/audited';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AdminLocaleQueryDto, BatchQueryDto, LocaleQueryDto, PublishDto, SaveDraftDto } from './cms.dto';
import { CmsService, etagOf } from './cms.service';

const PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=300';

function sendPublic(
  request: Request,
  response: Response,
  result: { body: unknown; preview: boolean },
): unknown {
  if (result.preview) {
    response.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    return result.body;
  }
  const etag = etagOf(result.body);
  response.set({ 'Cache-Control': PUBLIC_CACHE, ETag: etag });
  if (request.headers['if-none-match'] === etag) {
    response.status(304);
    return undefined;
  }
  return result.body;
}

@ApiTags('content')
@SkipThrottle()
@Controller('content')
export class CmsPublicController {
  constructor(private readonly cms: CmsService) {}

  // The batch route and specific routes must stay above ':key'.
  @Public()
  @Get('stats/homepage')
  @ApiOperation({ summary: 'Dynamic achievement statistics for Karnish Tourism homepage' })
  async homepageStats(@Query('foundingYear', new ParseIntPipe({ optional: true })) foundingYear?: number) {
    return this.cms.getHomepageStats(foundingYear);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Published content for several keys in one round trip (max 10)' })
  async batch(@Query() query: BatchQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return sendPublic(request, response, await this.cms.getPublicBatch(query.keys, query.locale, query.preview));
  }

  @Public()
  @Get(':key')
  @ApiOperation({ summary: 'Published content of one document (draft with a valid preview token)' })
  async one(
    @Param('key') key: string,
    @Query() query: LocaleQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendPublic(request, response, await this.cms.getPublic(key, query.locale, query.preview));
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/content')
@UseInterceptors(AuditInterceptor)
export class CmsAdminController {
  constructor(private readonly cms: CmsService) {}

  private static noStore(response: Response): void {
    response.set('Cache-Control', 'no-store');
  }

  @Get('stats/homepage')
  @RequirePermission('cms.read')
  @ApiOperation({ summary: 'Dynamic achievement statistics for homepage preview (admin)' })
  async homepageStats(@Query('foundingYear', new ParseIntPipe({ optional: true })) foundingYear?: number) {
    return this.cms.getHomepageStats(foundingYear);
  }

  @Get()
  @RequirePermission('cms.read')
  @ApiOperation({ summary: 'List editable documents with their publishing status' })
  list(@Query() query: AdminLocaleQueryDto, @Res({ passthrough: true }) response: Response) {
    CmsAdminController.noStore(response);
    return this.cms.list(query.locale);
  }

  @Get(':key')
  @RequirePermission('cms.read')
  @ApiOperation({ summary: 'Document with its schema, working copy and published payload' })
  async get(@Param('key') key: string, @Query() query: AdminLocaleQueryDto, @Res({ passthrough: true }) response: Response) {
    CmsAdminController.noStore(response);
    const view = await this.cms.getAdmin(key, query.locale);
    response.set('ETag', `"${view.version}.${view.draftRevision}"`);
    return view;
  }

  @Put(':key/draft')
  @RequirePermission('cms.write')
  @Audited('content', 'content.draft_save')
  @ApiOperation({ summary: 'Save the draft (validated; optimistic concurrency via draftRevision/If-Match)' })
  async saveDraft(
    @Param('key') key: string,
    @Query() query: AdminLocaleQueryDto,
    @Body() body: SaveDraftDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    CmsAdminController.noStore(response);
    const { view, changes } = await this.cms.saveDraft(key, query.locale, body, ifMatch, { id: user.sub, email: user.email });
    setAuditContext(request, { entityId: key, summary: `Saved draft of ${key}`, changes });
    response.set('ETag', `"${view.version}.${view.draftRevision}"`);
    return view;
  }

  @Post(':key/publish')
  @RequirePermission('cms.publish')
  @Audited('content', 'content.publish')
  @ApiOperation({ summary: 'Validate the draft strictly, snapshot a revision and publish it' })
  async publish(
    @Param('key') key: string,
    @Query() query: AdminLocaleQueryDto,
    @Body() body: PublishDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    CmsAdminController.noStore(response);
    const { view, changes } = await this.cms.publish(key, query.locale, body.note, body.draftRevision, {
      id: user.sub,
      email: user.email,
    });
    setAuditContext(request, { entityId: key, summary: `Published ${key} v${view.version}`, changes });
    return view;
  }

  @Post(':key/discard')
  @RequirePermission('cms.write')
  @Audited('content', 'content.discard')
  @ApiOperation({ summary: 'Drop the draft' })
  async discard(
    @Param('key') key: string,
    @Query() query: AdminLocaleQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    CmsAdminController.noStore(response);
    const { view, changes } = await this.cms.discard(key, query.locale);
    setAuditContext(request, { entityId: key, summary: `Discarded draft of ${key}`, changes });
    return view;
  }

  @Get(':key/revisions')
  @RequirePermission('cms.read')
  @ApiOperation({ summary: 'Published versions (newest first, last 50)' })
  revisions(@Param('key') key: string, @Query() query: AdminLocaleQueryDto, @Res({ passthrough: true }) response: Response) {
    CmsAdminController.noStore(response);
    return this.cms.listRevisions(key, query.locale);
  }

  @Get(':key/revisions/:version')
  @RequirePermission('cms.read')
  @ApiOperation({ summary: 'One published version with its content' })
  revision(
    @Param('key') key: string,
    @Param('version', ParseIntPipe) version: number,
    @Query() query: AdminLocaleQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    CmsAdminController.noStore(response);
    return this.cms.getRevision(key, query.locale, version);
  }

  @Post(':key/revisions/:version/restore')
  @RequirePermission('cms.write')
  @Audited('content', 'content.restore')
  @ApiOperation({ summary: 'Load a revision into the draft (never publishes)' })
  async restore(
    @Param('key') key: string,
    @Param('version', ParseIntPipe) version: number,
    @Query() query: AdminLocaleQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    CmsAdminController.noStore(response);
    const { view, changes } = await this.cms.restore(key, query.locale, version, { id: user.sub, email: user.email });
    setAuditContext(request, { entityId: key, summary: `Restored revision ${version} of ${key} into the draft`, changes });
    return view;
  }

  @Post(':key/preview-token')
  @RequirePermission('cms.read')
  @ApiOperation({ summary: 'Signed 15-minute preview token + site URL for the draft' })
  previewToken(@Param('key') key: string, @Query() query: AdminLocaleQueryDto, @Res({ passthrough: true }) response: Response) {
    CmsAdminController.noStore(response);
    return this.cms.createPreview(key, query.locale);
  }
}
