import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentRunsService } from './agent-runs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator.js';

@ApiTags('Templates')
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly agentRunsService: AgentRunsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all templates grouped by category' })
  async getTemplates() {
    const templates = await this.agentRunsService.getTemplates();
    return { data: templates };
  }

  @Post(':id/use')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Deep-copy a template into the user account' })
  @ApiResponse({ status: 201, description: 'Returns new team' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async useTemplate(
    @CurrentUser() user: RequestUser,
    @Param('id') templateId: string,
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true },
    });
    const team = await this.agentRunsService.useTemplate(
      user.id,
      templateId,
      dbUser!.plan,
    );
    return { data: team };
  }
}
