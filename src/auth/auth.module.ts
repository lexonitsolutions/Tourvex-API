import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { OptionalUserResolver } from './optional-user.resolver';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [OptionalUserResolver],
  exports: [OptionalUserResolver],
})
export class AuthModule {}
