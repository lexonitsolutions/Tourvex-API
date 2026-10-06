import { Body, Controller, Get, Header, Param, Put, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Audited, AuditInterceptor, setAuditContext } from '../../audit/audited';
import { diffChanges } from '../../audit/redact';
import { RequirePermission } from '../require-permission.decorator';
import { SettingsService } from './settings.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/settings')
@UseInterceptors(AuditInterceptor)
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get(':group')
  @RequirePermission('settings.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Effective settings of one group (general, commerce, notifications, homepage)' })
  get(@Param('group') group: string) {
    return this.settings.view(group);
  }

  /** The body is the complete group object; it replaces the stored one. */
  @Put(':group')
  @RequirePermission('settings.write')
  @Audited('settings', 'settings.update')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Replace the settings of one group (validated per group)' })
  async update(
    @Param('group') group: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const { view, before } = await this.settings.update(group, body, {
      id: user.sub,
      email: user.email,
    });
    setAuditContext(request, {
      entityId: group,
      summary: `Updated ${group} settings`,
      changes: diffChanges(before, view.values),
    });
    return view;
  }
}

@ApiTags('settings')
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('public')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Safe, cacheable site info: name, support contact, socials' })
  getPublic() {
    return this.settings.getPublic();
  }
}
