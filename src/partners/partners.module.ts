import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { Partner, PartnerSchema } from './schemas/partner.schema';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: Partner.name, schema: PartnerSchema }])],
  controllers: [PartnersController],
  providers: [PartnersService],
})
export class PartnersModule {}
