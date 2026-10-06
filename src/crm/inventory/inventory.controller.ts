import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { UpsertInventoryDto } from './dto/upsert-inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('crm-inventory')
@ApiBearerAuth()
@Controller('crm/inventory')
@Roles(Role.Operations, Role.Admin, Role.SuperAdmin)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list() {
    return this.inventory.list();
  }

  @Put()
  upsert(@Body() dto: UpsertInventoryDto) {
    return this.inventory.upsert(dto);
  }
}
