import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockModule } from '../stock/stock.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SettingsModule } from './settings/settings.module';
import { StaffController } from './staff/staff.controller';
import { StaffService } from './staff/staff.service';

@Module({
  imports: [
    UsersModule,
    SettingsModule,
    StockModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AdminController, StaffController],
  providers: [AdminService, StaffService],
})
export class AdminModule {}
