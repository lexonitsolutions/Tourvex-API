import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { BillingService } from './billing.service';

@ApiTags('crm-billing')
@ApiBearerAuth()
@Controller('crm/invoices')
@Roles(Role.Finance, Role.Admin, Role.SuperAdmin)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list() {
    return this.billing.list();
  }
}
