import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Audited, AuditInterceptor, setAuditContext } from '../../audit/audited';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../holidays/parse-object-id.pipe';
import { RequirePermission } from '../require-permission.decorator';
import { CreateStaffDto, ListStaffDto, UpdateStaffDto } from './staff.dto';
import { StaffResult, StaffService } from './staff.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/staff')
@UseInterceptors(AuditInterceptor)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermission('staff.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List staff (users with at least one staff role)' })
  list(@Query() query: ListStaffDto) {
    return this.staff.list(query);
  }

  @Get(':id')
  @RequirePermission('staff.read')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.staff.get(id);
  }

  @Post()
  @RequirePermission('staff.write')
  @Header('Cache-Control', 'no-store')
  @Audited('staff', 'staff.create')
  @ApiOperation({ summary: 'Create or promote a staff member by email' })
  async create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, await this.staff.create(dto, this.actor(user)));
  }

  @Patch(':id')
  @RequirePermission('staff.write')
  @Header('Cache-Control', 'no-store')
  @Audited('staff', 'staff.update')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, await this.staff.update(id, dto, this.actor(user)));
  }

  @Post(':id/deactivate')
  @RequirePermission('staff.write')
  @Header('Cache-Control', 'no-store')
  @Audited('staff', 'staff.deactivate')
  async deactivate(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, await this.staff.setActive(id, false, this.actor(user)));
  }

  @Post(':id/reactivate')
  @RequirePermission('staff.write')
  @Header('Cache-Control', 'no-store')
  @Audited('staff', 'staff.reactivate')
  async reactivate(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, await this.staff.setActive(id, true, this.actor(user)));
  }

  private actor(user: AuthenticatedUser) {
    return { id: user.sub, roles: user.roles };
  }

  private respond(request: Request, result: StaffResult) {
    setAuditContext(request, {
      entityId: result.staff.id,
      summary: result.summary,
      changes: result.changes,
    });
    return result.staff;
  }
}
