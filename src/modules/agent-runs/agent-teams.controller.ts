import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentRunsService } from './agent-runs.service.js';
import { CreateAgentTeamDto } from './dto/create-agent-team.dto.js';
import { UpdateAgentTeamDto } from './dto/update-agent-team.dto.js';
import { AgentTeamResponseDto } from './dto/agent-team-response.dto.js';
import { SaveTeamGraphDto } from './dto/agent-library-item.dto.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('Agent Teams')
@Controller('agent-teams')
export class AgentTeamsController {
  constructor(
    private readonly agentRunsService: AgentRunsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an agent team with agents' })
  @ApiResponse({ status: 201, type: AgentTeamResponseDto })
  @ApiResponse({ status: 403, description: 'Team limit reached' })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAgentTeamDto,
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true },
    });
    const team = await this.agentRunsService.createTeam(
      user.id,
      dbUser!.plan,
      dto,
    );
    return { data: team };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List agent teams (paginated)' })
  async list(
    @CurrentUser() user: RequestUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.agentRunsService.getTeams(
      user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
    return {
      data: result.items,
      meta: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
      },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get agent team by ID with agents' })
  @ApiResponse({ status: 200, type: AgentTeamResponseDto })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const team = await this.agentRunsService.getTeamById(user.id, id);
    return { data: team };
  }

  @Patch(':id')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an agent team' })
  @ApiResponse({ status: 200, type: AgentTeamResponseDto })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAgentTeamDto,
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true },
    });
    const team = await this.agentRunsService.updateTeam(
      user.id,
      id,
      dbUser!.plan,
      dto,
    );
    return { data: team };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent team (cascades to agents)' })
  @ApiResponse({ status: 204, description: 'Team deleted' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.agentRunsService.deleteTeam(user.id, id);
  }

  @Get(':id/graph')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get team workflow graph (agents + connections) for canvas',
  })
  async getGraph(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const graph = await this.agentRunsService.getTeamGraph(user.id, id);
    return { data: graph };
  }

  @Post(':id/graph')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save team workflow graph atomically' })
  @ApiResponse({ status: 200, description: 'Graph saved' })
  @ApiResponse({ status: 400, description: 'Circular dependency detected' })
  async saveGraph(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SaveTeamGraphDto,
  ) {
    const graph = await this.agentRunsService.saveTeamGraph(user.id, id, dto);
    return { data: graph };
  }
}
