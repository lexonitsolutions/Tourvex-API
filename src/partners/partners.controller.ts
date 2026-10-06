import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { ListPartnersDto } from './dto/list-partners.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { PartnersService } from './partners.service';

@ApiTags('partners')
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Attraction partners strip; items is empty when nothing is visible' })
  list(@Query() query: ListPartnersDto) {
    return this.partners.list(query);
  }

  // Static routes must stay above ':id'.

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Get('admin/all')
  @ApiOperation({ summary: 'List every partner including unpublished and sample ones' })
  listAll() {
    return this.partners.listAll();
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a partner' })
  create(@Body() dto: CreatePartnerDto) {
    return this.partners.create(dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a partner' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(id, dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a partner' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.partners.remove(id);
  }
}
