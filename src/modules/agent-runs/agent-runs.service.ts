import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { Plan, AgentRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OpenRouterService } from '../openrouter/openrouter.service.js';
import {
  CONCURRENT_RUN_LIMIT,
  DEFAULT_MODEL,
  MODEL_REGISTRY,
  MONTHLY_RUN_LIMIT,
  TEAM_LIMIT,
  TOKEN_BUDGET_PER_RUN,
} from '../openrouter/constants/model-registry.js';
import {
  AGENT_RUN_QUEUE,
  type AgentRunJobData,
} from './agent-run.processor.js';
import type { CreateAgentTeamDto } from './dto/create-agent-team.dto.js';
import type { UpdateAgentTeamDto } from './dto/update-agent-team.dto.js';
import type { CreateAgentRunDto } from './dto/create-agent-run.dto.js';
import type {
  CreateAgentLibraryItemDto,
  SaveTeamGraphDto,
} from './dto/agent-library-item.dto.js';
import { buildDAG, detectCycle } from './dag-utils.js';

@Injectable()
export class AgentRunsService {
  private readonly logger = new Logger(AgentRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterService,
    @InjectQueue(AGENT_RUN_QUEUE) private readonly runQueue: Queue,
  ) {}

  // ─── Agent Teams CRUD ───

  async createTeam(userId: string, plan: Plan, dto: CreateAgentTeamDto) {
    // Check team limit (only count non-template teams)
    const teamCount = await this.prisma.agentTeam.count({
      where: { userId, isTemplate: false },
    });
    const limit = TEAM_LIMIT[plan];
    if (teamCount >= limit) {
      throw new ForbiddenException(
        `Team limit reached (${teamCount}/${limit}). Upgrade your plan to create more teams.`,
      );
    }

    const model = dto.model ?? 'mistralai/mistral-small-3.1-24b-instruct';
    const hasOwnKey = await this.openRouter.userHasOwnKey(userId);
    this.openRouter.validateModelForUser(model, plan, hasOwnKey);

    return this.prisma.agentTeam.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        goal: dto.goal,
        model,
        agents: {
          create: dto.agents.map((a) => ({
            role: a.role as AgentRole,
            systemPrompt: a.systemPrompt,
            order: a.order,
            enabled: a.enabled ?? true,
          })),
        },
      },
      include: { agents: { orderBy: { order: 'asc' } } },
    });
  }

  async getTeams(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [teams, total] = await Promise.all([
      this.prisma.agentTeam.findMany({
        where: { userId },
        include: {
          _count: { select: { agents: true } },
          runs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.agentTeam.count({ where: { userId } }),
    ]);

    return {
      items: teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        goal: t.goal,
        model: t.model,
        agentCount: t._count.agents,
        lastRunAt: t.runs[0]?.createdAt ?? null,
        createdAt: t.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTeamById(userId: string, teamId: string) {
    const team = await this.prisma.agentTeam.findUnique({
      where: { id: teamId },
      include: { agents: { orderBy: { order: 'asc' } } },
    });

    if (!team || team.userId !== userId) {
      throw new NotFoundException('Agent team not found');
    }

    return team;
  }

  async updateTeam(
    userId: string,
    teamId: string,
    plan: Plan,
    dto: UpdateAgentTeamDto,
  ) {
    const team = await this.prisma.agentTeam.findUnique({
      where: { id: teamId },
    });

    if (!team || team.userId !== userId) {
      throw new NotFoundException('Agent team not found');
    }

    if (dto.model) {
      const hasOwnKey = await this.openRouter.userHasOwnKey(userId);
      this.openRouter.validateModelForUser(dto.model, plan, hasOwnKey);
    }

    if (dto.agents) {
      const activeRuns = await this.prisma.agentRun.count({
        where: { teamId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (activeRuns > 0) {
        throw new ConflictException(
          'Cannot replace agents while runs are in progress. Wait for active runs to complete.',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.agentTeam.update({
        where: { id: teamId },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.goal && { goal: dto.goal }),
          ...(dto.model && { model: dto.model }),
        },
      });

      if (dto.agents) {
        await tx.agent.deleteMany({ where: { teamId } });
        await tx.agent.createMany({
          data: dto.agents.map((a) => ({
            teamId,
            role: a.role as AgentRole,
            systemPrompt: a.systemPrompt,
            order: a.order,
            enabled: a.enabled ?? true,
          })),
        });
      }

      return tx.agentTeam.findUnique({
        where: { id: updated.id },
        include: { agents: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async deleteTeam(userId: string, teamId: string) {
    const team = await this.prisma.agentTeam.findUnique({
      where: { id: teamId },
      include: {
        runs: {
          where: { status: { in: ['QUEUED', 'RUNNING'] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!team || team.userId !== userId) {
      throw new NotFoundException('Agent team not found');
    }

    if (team.runs.length > 0) {
      throw new ConflictException(
        'Cannot delete team while runs are in progress. Wait for active runs to complete.',
      );
    }

    try {
      await this.prisma.agentTeam.delete({ where: { id: teamId } });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Agent team not found');
      }
      throw error;
    }
  }

  // ─── Agent Runs ───

  async createRun(
    userId: string,
    _email: string,
    plan: Plan,
    dto: CreateAgentRunDto,
  ) {
    // Verify team ownership
    const team = await this.prisma.agentTeam.findUnique({
      where: { id: dto.teamId },
    });

    if (!team || team.userId !== userId) {
      throw new NotFoundException('Agent team not found');
    }

    const model = dto.model ?? team.model;

    // Resolve API key first — need to know if user has own key for model validation
    const { apiKey, hasOwnKey } = await this.openRouter.resolveApiKey(userId);

    // Validate model — own key = any model, platform key = registry only
    this.openRouter.validateModelForUser(model, plan, hasOwnKey);

    // Check concurrent run limit
    const activeRuns = await this.prisma.agentRun.count({
      where: {
        userId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
    });

    const concurrentLimit = CONCURRENT_RUN_LIMIT[plan];
    if (activeRuns >= concurrentLimit) {
      throw new ForbiddenException(
        `Concurrent run limit reached (${activeRuns}/${concurrentLimit}). Wait for active runs to complete or upgrade your plan.`,
      );
    }

    // Check monthly run limit
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const runsThisMonth = await this.prisma.agentRun.count({
      where: {
        userId,
        createdAt: { gte: monthStart },
      },
    });

    const monthlyLimit = MONTHLY_RUN_LIMIT[plan];
    if (runsThisMonth >= monthlyLimit) {
      throw new ForbiddenException(
        `Monthly run limit reached (${runsThisMonth}/${monthlyLimit}). Upgrade your plan for more runs.`,
      );
    }

    // Create run record
    const run = await this.prisma.agentRun.create({
      data: {
        teamId: dto.teamId,
        userId,
        goal: dto.goal,
        model,
        status: 'QUEUED',
      },
    });

    // Enqueue BullMQ job
    const jobData: AgentRunJobData = {
      runId: run.id,
      teamId: dto.teamId,
      goal: dto.goal,
      apiKey,
      model,
      plan,
    };

    await this.runQueue.add('run-pipeline', jobData, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.logger.log(
      { runId: run.id, teamId: dto.teamId, model, userId },
      'Agent run enqueued',
    );

    return { runId: run.id };
  }

  async getRuns(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        where: { userId },
        include: {
          team: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.agentRun.count({ where: { userId } }),
    ]);

    return {
      items: runs.map((r) => ({
        id: r.id,
        teamId: r.teamId,
        teamName: r.team.name,
        goal: r.goal,
        model: r.model,
        status: r.status,
        totalTokensUsed: r.totalTokensUsed,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        createdAt: r.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getRunById(userId: string, runId: string) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        steps: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            output: true,
            tokenCount: true,
            durationMs: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!run || run.userId !== userId) {
      throw new NotFoundException('Agent run not found');
    }

    return {
      id: run.id,
      teamId: run.teamId,
      goal: run.goal,
      model: run.model,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      errorMessage: run.errorMessage,
      totalTokensUsed: run.totalTokensUsed,
      steps: run.steps,
      createdAt: run.createdAt,
    };
  }

  async verifyRunOwnership(userId: string, runId: string): Promise<boolean> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { userId: true },
    });
    return run?.userId === userId;
  }

  async checkUserHasOwnKey(userId: string): Promise<boolean> {
    return this.openRouter.userHasOwnKey(userId);
  }

  // ─── User Usage Stats ───

  async getUserUsageStats(userId: string, plan: Plan) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      runsThisMonth,
      activeRuns,
      teamCount,
      totalTokensThisMonth,
      totalRunsAll,
      recentRuns,
    ] = await Promise.all([
      this.prisma.agentRun.count({
        where: { userId, createdAt: { gte: monthStart } },
      }),
      this.prisma.agentRun.count({
        where: { userId, status: { in: ['QUEUED', 'RUNNING'] } },
      }),
      this.prisma.agentTeam.count({ where: { userId, isTemplate: false } }),
      this.prisma.agentRun.aggregate({
        _sum: { totalTokensUsed: true },
        where: { userId, createdAt: { gte: monthStart } },
      }),
      this.prisma.agentRun.count({ where: { userId } }),
      this.prisma.agentRun.findMany({
        where: { userId },
        select: {
          id: true,
          goal: true,
          model: true,
          status: true,
          totalTokensUsed: true,
          createdAt: true,
          team: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const monthlyRunLimit = MONTHLY_RUN_LIMIT[plan];
    const concurrentRunLimit = CONCURRENT_RUN_LIMIT[plan];
    const teamLimit = TEAM_LIMIT[plan];
    const tokenBudget = TOKEN_BUDGET_PER_RUN[plan];

    return {
      plan,
      usage: {
        runsThisMonth,
        runsLimit: monthlyRunLimit === Infinity ? null : monthlyRunLimit,
        runsRemaining:
          monthlyRunLimit === Infinity
            ? null
            : Math.max(0, monthlyRunLimit - runsThisMonth),
        activeRuns,
        activeRunsLimit:
          concurrentRunLimit === Infinity ? null : concurrentRunLimit,
        teams: teamCount,
        teamsLimit: teamLimit === Infinity ? null : teamLimit,
        tokensThisMonth: totalTokensThisMonth._sum.totalTokensUsed ?? 0,
        tokenBudgetPerRun: tokenBudget,
        totalRunsAllTime: totalRunsAll,
      },
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        goal: r.goal,
        model: r.model,
        status: r.status,
        totalTokensUsed: r.totalTokensUsed,
        teamName: r.team.name,
        createdAt: r.createdAt,
      })),
    };
  }

  // ─── Agent Library ───

  async getLibraryItems() {
    const items = await this.prisma.agentLibraryItem.findMany({
      where: { isPublic: true },
      select: {
        id: true,
        name: true,
        description: true,
        role: true,
        category: true,
        usageCount: true,
        createdAt: true,
      },
      orderBy: [{ category: 'asc' }, { usageCount: 'desc' }],
    });

    const grouped: Record<string, typeof items> = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    return grouped;
  }

  async createLibraryItem(userId: string, dto: CreateAgentLibraryItemDto) {
    const item = await this.prisma.agentLibraryItem.create({
      data: {
        name: dto.name,
        description: dto.description,
        role: dto.role as AgentRole,
        systemPrompt: dto.systemPrompt,
        category: dto.category,
        isPublic: false,
        createdByUserId: userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        role: true,
        category: true,
        usageCount: true,
        createdAt: true,
      },
    });
    return item;
  }

  // ─── Team Graph (Canvas) ───

  async getTeamGraph(userId: string, teamId: string) {
    const team = await this.prisma.agentTeam.findUnique({
      where: { id: teamId },
      include: {
        agents: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            role: true,
            systemPrompt: true,
            order: true,
            enabled: true,
            libraryItemId: true,
          },
        },
        connections: {
          select: {
            id: true,
            fromAgentId: true,
            toAgentId: true,
            inputKey: true,
          },
        },
      },
    });

    if (!team || (team.userId && team.userId !== userId && !team.isTemplate)) {
      throw new NotFoundException('Agent team not found');
    }

    return {
      agents: team.agents,
      connections: team.connections,
      canvasLayout: team.canvasLayout,
    };
  }

  async saveTeamGraph(userId: string, teamId: string, dto: SaveTeamGraphDto) {
    const team = await this.prisma.agentTeam.findUnique({
      where: { id: teamId },
    });
    if (!team || team.userId !== userId) {
      throw new NotFoundException('Agent team not found');
    }

    const activeRuns = await this.prisma.agentRun.count({
      where: { teamId, status: { in: ['QUEUED', 'RUNNING'] } },
    });
    if (activeRuns > 0) {
      throw new ConflictException(
        'Cannot update workflow while runs are in progress. Wait for active runs to complete.',
      );
    }

    // Validate no cycles
    const tempAgentIds = dto.agents.map((_, i) => `temp-${i}`);
    const tempConnections = dto.connections.map((c) => ({
      fromAgentId: `temp-${c.fromAgentIndex}`,
      toAgentId: `temp-${c.toAgentIndex}`,
    }));
    const dag = buildDAG(tempAgentIds, tempConnections);
    if (detectCycle(dag)) {
      throw new BadRequestException(
        'Workflow has a circular dependency — fix connections in the canvas.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.agentConnection.deleteMany({ where: { teamId } });
      await tx.agent.deleteMany({ where: { teamId } });

      const createdAgents = [];
      for (const a of dto.agents) {
        const agent = await tx.agent.create({
          data: {
            teamId,
            role: a.role as AgentRole,
            systemPrompt: a.systemPrompt,
            order: 0,
            enabled: a.enabled ?? true,
            libraryItemId: a.libraryItemId ?? null,
          },
        });
        createdAgents.push(agent);
      }

      for (const conn of dto.connections) {
        const fromAgent = createdAgents[conn.fromAgentIndex];
        const toAgent = createdAgents[conn.toAgentIndex];
        if (fromAgent && toAgent) {
          await tx.agentConnection.create({
            data: {
              teamId,
              fromAgentId: fromAgent.id,
              toAgentId: toAgent.id,
              inputKey: conn.inputKey ?? 'output',
            },
          });
        }
      }

      if (dto.canvasLayout) {
        await tx.agentTeam.update({
          where: { id: teamId },
          data: { canvasLayout: dto.canvasLayout as object },
        });
      }

      return this.getTeamGraph(userId, teamId);
    });
  }

  // ─── Templates ───

  async getTemplates() {
    const templates = await this.prisma.agentTeam.findMany({
      where: { isTemplate: true },
      include: {
        agents: {
          orderBy: { order: 'asc' },
          select: { id: true, role: true, order: true },
        },
      },
      orderBy: { category: 'asc' },
    });

    const grouped: Record<string, typeof templates> = {};
    for (const tpl of templates) {
      const cat = tpl.category ?? 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(tpl);
    }
    return grouped;
  }

  async useTemplate(userId: string, templateId: string, plan: Plan) {
    // Check team limit before creating from template
    const teamCount = await this.prisma.agentTeam.count({
      where: { userId, isTemplate: false },
    });
    const limit = TEAM_LIMIT[plan];
    if (teamCount >= limit) {
      throw new ForbiddenException(
        `Team limit reached (${teamCount}/${limit}). Upgrade your plan to create more teams.`,
      );
    }

    const template = await this.prisma.agentTeam.findUnique({
      where: { id: templateId },
      include: {
        agents: { orderBy: { order: 'asc' } },
        connections: true,
      },
    });

    if (!template || !template.isTemplate) {
      throw new NotFoundException('Template not found');
    }

    // Override model if the template's model isn't available on the user's plan
    const hasOwnKey = await this.openRouter.userHasOwnKey(userId);
    const allowedModels = MODEL_REGISTRY[plan] as readonly string[];
    const model =
      hasOwnKey || allowedModels.includes(template.model)
        ? template.model
        : DEFAULT_MODEL[plan];

    return this.prisma.$transaction(async (tx) => {
      const newTeam = await tx.agentTeam.create({
        data: {
          userId,
          name: template.name,
          description: template.description,
          goal: template.goal,
          model,
          isTemplate: false,
          isPublic: false,
          category: template.category,
          canvasLayout: template.canvasLayout ?? undefined,
        },
      });

      const oldToNew = new Map<string, string>();

      for (const agent of template.agents) {
        const newAgent = await tx.agent.create({
          data: {
            teamId: newTeam.id,
            role: agent.role,
            systemPrompt: agent.systemPrompt,
            order: agent.order,
            enabled: agent.enabled,
            libraryItemId: agent.libraryItemId,
          },
        });
        oldToNew.set(agent.id, newAgent.id);
      }

      for (const conn of template.connections) {
        const newFrom = oldToNew.get(conn.fromAgentId);
        const newTo = oldToNew.get(conn.toAgentId);
        if (newFrom && newTo) {
          await tx.agentConnection.create({
            data: {
              teamId: newTeam.id,
              fromAgentId: newFrom,
              toAgentId: newTo,
              inputKey: conn.inputKey,
            },
          });
        }
      }

      await tx.agentLibraryItem.updateMany({
        where: {
          id: {
            in: template.agents
              .filter((a) => a.libraryItemId)
              .map((a) => a.libraryItemId!),
          },
        },
        data: { usageCount: { increment: 1 } },
      });

      return tx.agentTeam.findUnique({
        where: { id: newTeam.id },
        include: { agents: { orderBy: { order: 'asc' } }, connections: true },
      });
    });
  }
}
