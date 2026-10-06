import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection, ConnectionStates } from 'mongoose';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database readiness check' })
  check() {
    const database = this.connection.readyState === ConnectionStates.connected ? 'up' : 'down';
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'tourvex-api',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
