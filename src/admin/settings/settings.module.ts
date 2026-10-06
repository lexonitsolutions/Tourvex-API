import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminSettingsController, PublicSettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SiteSetting, SiteSettingSchema } from './settings.schema';

/** Global so checkout, catalog and currency can read commerce settings without import cycles. */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: SiteSetting.name, schema: SiteSettingSchema }])],
  controllers: [AdminSettingsController, PublicSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
