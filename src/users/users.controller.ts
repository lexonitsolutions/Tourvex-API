import { Body, Controller, Get, Param, Patch, Post, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { Audited, AuditInterceptor, setAuditContext } from '../audit/audited';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { CreatePartnerApplicationDto } from './dto/create-partner-application.dto';
import { ReviewPartnerApplicationDto } from './dto/review-partner-application.dto';
import { UpdateRolesDto } from './dto/update-roles.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseInterceptors(AuditInterceptor)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.Admin, Role.SuperAdmin)
  list() {
    return this.users.list();
  }

  /** Any signed-in user may apply to become a B2B partner. Returns the `/auth/me` profile. */
  @Post('me/partner-application')
  applyForPartnership(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePartnerApplicationDto,
  ) {
    return this.users.submitPartnerApplication(user.sub, dto);
  }

  @Patch(':id/partner-application')
  @Roles(Role.Admin, Role.SuperAdmin)
  reviewPartnerApplication(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReviewPartnerApplicationDto,
    @CurrentUser() reviewer: AuthenticatedUser,
  ) {
    return this.users.reviewPartnerApplication(id, dto, reviewer.sub);
  }

  /** Legacy route: now audited and bound by the staff rules (no self-change, admins need a super admin, last super admin protected). */
  @Patch(':id/status')
  @Roles(Role.Admin, Role.SuperAdmin)
  @Audited('user', 'user.status')
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.users.updateStatusAs({ id: actor.sub, roles: actor.roles }, id, dto.status);
    setAuditContext(request, {
      entityId: id,
      summary: 'Changed user status to ' + dto.status,
      changes: [{ field: 'status', from: result.before, to: result.after }],
    });
    return result.user;
  }

  /** Legacy route: now audited and bound by the staff rules (no self-change, last super admin protected). */
  @Patch(':id/roles')
  @Roles(Role.SuperAdmin)
  @Audited('user', 'user.roles')
  async updateRoles(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateRolesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.users.updateRolesAs({ id: actor.sub, roles: actor.roles }, id, dto.roles);
    setAuditContext(request, {
      entityId: id,
      summary: 'Changed user roles',
      changes: [{ field: 'roles', from: result.before, to: result.after }],
    });
    return result.user;
  }
}
