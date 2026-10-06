import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { StaffDirectoryService } from './staff-directory.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [StaffDirectoryService],
  exports: [StaffDirectoryService],
})
export class StaffDirectoryModule {}
