import { PartialType } from '@nestjs/swagger';
import { CreateCruiseDto } from './create-cruise.dto';

export class UpdateCruiseDto extends PartialType(CreateCruiseDto) {}
