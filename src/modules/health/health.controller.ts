import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';

@Controller('health')
export class HealthController {
  @Get()
  @Public() // Health check must be accessible without authentication
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'API is healthy' })
  getHealth() {
    return {
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
