import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AgentRunsService } from './agent-runs.service.js';
import { CreateAgentRunDto } from './dto/create-agent-run.dto.js';
import { AgentRunResponseDto } from './dto/agent-run-response.dto.js';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator.js';

@ApiTags('Agent Runs')
@Controller('agent-runs')
export class AgentRunsController {
  constructor(
    private readonly agentRunsService: AgentRunsService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a new agent run' })
  @ApiResponse({ status: 200, description: 'Returns runId' })
  @ApiResponse({ status: 403, description: 'Plan limit reached' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAgentRunDto,
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true },
    });
    const result = await this.agentRunsService.createRun(
      user.id,
      user.email,
      dbUser!.plan,
      dto,
    );
    return { data: result };
  }

  @Get('model-options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get available models for current user (based on plan + own key)',
  })
  async getModelOptions(@CurrentUser() user: RequestUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true },
    });
    const hasOwnKey = await this.agentRunsService.checkUserHasOwnKey(user.id);
    const { MODEL_REGISTRY } =
      await import('../openrouter/constants/model-registry.js');
    const registryModels = MODEL_REGISTRY[dbUser!.plan];
    return {
      data: {
        hasOwnKey,
        plan: dbUser!.plan,
        registryModels: [...registryModels],
        canUseAnyModel: hasOwnKey,
        note: hasOwnKey
          ? 'You have your own API key — you can use any OpenRouter model.'
          : 'Add your OpenRouter key in Settings to unlock all models.',
      },
    };
  }

  @Get('usage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user usage stats and limits' })
  async getUsage(@CurrentUser() user: RequestUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true },
    });
    const stats = await this.agentRunsService.getUserUsageStats(
      user.id,
      dbUser!.plan,
    );
    return { data: stats };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List agent runs (paginated)' })
  async list(
    @CurrentUser() user: RequestUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.agentRunsService.getRuns(
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
  @ApiOperation({ summary: 'Get agent run with all steps' })
  @ApiResponse({ status: 200, type: AgentRunResponseDto })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const run = await this.agentRunsService.getRunById(user.id, id);
    return { data: run };
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream agent run output via SSE' })
  @ApiResponse({ status: 200, description: 'SSE stream' })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to stream this run',
  })
  async stream(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const isOwner = await this.agentRunsService.verifyRunOwnership(user.id, id);
    if (!isOwner) {
      throw new ForbiddenException('Not authorized to stream this run');
    }

    // 1. Create subscriber and await subscription BEFORE flushing headers
    const subscriber = this.redisService.createSubscriber();
    const channel = `agent-run:${id}`;
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
    };

    try {
      await subscriber.subscribe(channel);
    } catch {
      subscriber.quit().catch(() => {});
      res.status(503).json({ message: 'Stream temporarily unavailable' });
      return;
    }

    // 2. Snapshot current run state (covers race where steps ran before subscribe)
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      select: {
        status: true,
        errorMessage: true,
        totalTokensUsed: true,
        startedAt: true,
        completedAt: true,
        steps: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            agentId: true,
            role: true,
            output: true,
            tokenCount: true,
            durationMs: true,
            status: true,
          },
        },
      },
    });

    // 3. NOW set headers and flush — subscription is guaranteed active
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 4. If run is already terminal, send final event and close
    if (run?.status === 'COMPLETED') {
      const elapsed =
        run.completedAt && run.startedAt
          ? new Date(run.completedAt).getTime() -
            new Date(run.startedAt).getTime()
          : 0;
      // Replay all steps so the client sees the full output
      for (const step of run.steps) {
        res.write(
          `event: step_start\ndata: ${JSON.stringify({ stepId: step.id, role: step.role, agentId: step.agentId })}\n\n`,
        );
        if (step.output) {
          res.write(
            `event: token\ndata: ${JSON.stringify({ stepId: step.id, token: step.output })}\n\n`,
          );
        }
        res.write(
          `event: step_complete\ndata: ${JSON.stringify({ stepId: step.id, role: step.role, tokenCount: step.tokenCount, durationMs: step.durationMs })}\n\n`,
        );
      }
      res.write(
        `event: run_complete\ndata: ${JSON.stringify({ runId: id, totalTokens: run.totalTokensUsed, totalDurationMs: elapsed })}\n\n`,
      );
      cleanup();
      res.end();
      return;
    }
    if (run?.status === 'FAILED') {
      // Replay completed steps before the error
      for (const step of run?.steps ?? []) {
        res.write(
          `event: step_start\ndata: ${JSON.stringify({ stepId: step.id, role: step.role, agentId: step.agentId })}\n\n`,
        );
        if (step.output) {
          res.write(
            `event: token\ndata: ${JSON.stringify({ stepId: step.id, token: step.output })}\n\n`,
          );
        }
        if (step.status === 'COMPLETED') {
          res.write(
            `event: step_complete\ndata: ${JSON.stringify({ stepId: step.id, role: step.role, tokenCount: step.tokenCount, durationMs: step.durationMs })}\n\n`,
          );
        }
      }
      res.write(
        `event: run_error\ndata: ${JSON.stringify({ runId: id, error: run.errorMessage ?? 'Run failed' })}\n\n`,
      );
      cleanup();
      res.end();
      return;
    }

    // 5. Run is active — replay COMPLETED steps from DB, let RUNNING steps flow via Redis
    const alreadyEmittedStepIds = new Set<string>();
    if (run?.steps) {
      for (const step of run.steps) {
        res.write(
          `event: step_start\ndata: ${JSON.stringify({ stepId: step.id, role: step.role, agentId: step.agentId })}\n\n`,
        );
        if (step.status === 'COMPLETED') {
          alreadyEmittedStepIds.add(step.id);
          if (step.output) {
            res.write(
              `event: token\ndata: ${JSON.stringify({ stepId: step.id, token: step.output })}\n\n`,
            );
          }
          res.write(
            `event: step_complete\ndata: ${JSON.stringify({ stepId: step.id, role: step.role, tokenCount: step.tokenCount, durationMs: step.durationMs })}\n\n`,
          );
        }
      }
    }

    // 6. Heartbeat to prevent proxy timeouts
    heartbeat = setInterval(() => {
      if (!closed) res.write(':ping\n\n');
    }, 15_000);

    // 7. Handle Redis subscriber errors
    subscriber.on('error', () => {
      if (!closed) {
        cleanup();
        res.end();
      }
    });

    // 8. Forward events to SSE (skip events for steps already replayed from DB)
    subscriber.on('message', (_ch: string, message: string) => {
      if (closed) return;
      try {
        const parsed = JSON.parse(message) as {
          event: string;
          data: Record<string, unknown>;
        };

        const stepId = parsed.data?.stepId as string | undefined;

        if (stepId && alreadyEmittedStepIds.has(stepId)) {
          return;
        }

        res.write(
          `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`,
        );

        if (parsed.event === 'run_complete' || parsed.event === 'run_error') {
          cleanup();
          res.end();
        }
      } catch {
        // Skip malformed messages
      }
    });

    res.on('close', cleanup);
  }
}
