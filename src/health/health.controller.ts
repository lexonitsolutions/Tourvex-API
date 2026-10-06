import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection, ConnectionStates } from 'mongoose';
import { CacheService } from '../common/cache/cache.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly cache: CacheService,
  ) {}

  private get database(): 'up' | 'down' {
    return this.connection.readyState === ConnectionStates.connected ? 'up' : 'down';
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database readiness check' })
  check() {
    return {
      status: this.database === 'up' ? 'ok' : 'degraded',
      service: 'tourvex-api',
      database: this.database,
      // `redis` | `memory` (Redis not configured or unreachable: the API still works) | `disabled`
      cache: this.cache.mode,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: 200 only while the database is reachable (503 otherwise). The cache never affects it.' })
  ready() {
    if (this.database !== 'up') throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' });
    return { status: 'ready' };
  }
}
