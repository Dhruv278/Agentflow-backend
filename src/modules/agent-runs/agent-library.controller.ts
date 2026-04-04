import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentRunsService } from './agent-runs.service.js';
import {
  CreateAgentLibraryItemDto,
  AgentLibraryItemResponseDto,
} from './dto/agent-library-item.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator.js';

@ApiTags('Agent Library')
@Controller('agent-library')
export class AgentLibraryController {
  constructor(private readonly agentRunsService: AgentRunsService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all public agent library items grouped by category',
  })
  @ApiResponse({ status: 200, type: [AgentLibraryItemResponseDto] })
  async getLibrary() {
    const items = await this.agentRunsService.getLibraryItems();
    return { data: items };
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a private agent library item' })
  @ApiResponse({ status: 201, type: AgentLibraryItemResponseDto })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAgentLibraryItemDto,
  ) {
    const item = await this.agentRunsService.createLibraryItem(user.id, dto);
    return { data: item };
  }
}
