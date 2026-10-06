import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';

/** Dashboard (`GET /admin/dashboard`) and report endpoints (`/admin/reports/*`). Reads collections directly. */
@Module({
  imports: [AuditModule],
  controllers: [AdminReportsController],
  providers: [AdminReportsService],
})
export class AdminReportsModule {}
