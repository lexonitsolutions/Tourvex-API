import { Controller, Get, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { RequirePermission } from './require-permission.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Signed-in staff member, permissions and the server-built menu (403 for non-staff)' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.me(user);
  }

  @Get('summary')
  @RequirePermission('dashboard.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Dashboard counts: bookings today/pending, open enquiries and tickets, new customers (7 days)' })
  summary() {
    return this.admin.summary();
  }
}
