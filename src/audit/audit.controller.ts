import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../admin/require-permission.decorator';
import { AuditService } from './audit.service';
import { ListAuditDto } from './dto/list-audit.dto';

/** Read-only by design: there are no update or delete endpoints for audit entries. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Audit log, newest first' })
  list(@Query() query: ListAuditDto) {
    return this.audit.list(query);
  }
}
