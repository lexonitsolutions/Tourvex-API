import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaModule } from '../media/media.module';
import { CmsMediaController } from './cms-media.controller';
import { CmsAdminController, CmsPublicController } from './cms.controller';
import { CmsDocument, CmsDocumentSchema } from './cms.schema';
import { CmsService } from './cms.service';

@Module({
  imports: [MediaModule, MongooseModule.forFeature([{ name: CmsDocument.name, schema: CmsDocumentSchema }])],
  controllers: [CmsPublicController, CmsAdminController, CmsMediaController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
