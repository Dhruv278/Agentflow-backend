import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AgentRole } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getDashboardStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      activeUsers,
      planCounts,
      totalTeams,
      totalRuns,
      runsThisMonth,
      totalTokens,
      tokensThisMonth,
      totalLibraryAgents,
      totalTemplates,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.groupBy({ by: ['plan'], _count: true }),
      this.prisma.agentTeam.count({ where: { isTemplate: false } }),
      this.prisma.agentRun.count(),
      this.prisma.agentRun.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.agentRun.aggregate({ _sum: { totalTokensUsed: true } }),
      this.prisma.agentRun.aggregate({
        _sum: { totalTokensUsed: true },
        where: { createdAt: { gte: monthStart } },
      }),
      this.prisma.agentLibraryItem.count({ where: { isPublic: true } }),
      this.prisma.agentTeam.count({ where: { isTemplate: true } }),
    ]);

    const plans: Record<string, number> = {};
    for (const p of planCounts) {
      plans[p.plan] = p._count;
    }

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        byPlan: plans,
      },
      teams: totalTeams,
      runs: {
        total: totalRuns,
        thisMonth: runsThisMonth,
      },
      tokens: {
        total: totalTokens._sum.totalTokensUsed ?? 0,
        thisMonth: tokensThisMonth._sum.totalTokensUsed ?? 0,
      },
      library: {
        platformAgents: totalLibraryAgents,
        templates: totalTemplates,
      },
    };
  }

  async getUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          plan: true,
          status: true,
          createdAt: true,
          _count: {
            select: { agentTeams: true, agentRuns: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count(),
    ]);

    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        status: u.status,
        teamCount: u._count.agentTeams,
        runCount: u._count.agentRuns,
        createdAt: u.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getLibraryAgents() {
    return this.prisma.agentLibraryItem.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        role: true,
        systemPrompt: true,
        category: true,
        isPublic: true,
        usageCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async updateLibraryAgent(
    agentId: string,
    data: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      category?: string;
      role?: AgentRole;
    },
  ) {
    const agent = await this.prisma.agentLibraryItem.findUnique({
      where: { id: agentId },
    });
    if (!agent) throw new NotFoundException('Agent not found');

    return this.prisma.agentLibraryItem.update({
      where: { id: agentId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description && { description: data.description }),
        ...(data.systemPrompt && { systemPrompt: data.systemPrompt }),
        ...(data.category && { category: data.category }),
        ...(data.role && { role: data.role }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        role: true,
        systemPrompt: true,
        category: true,
        isPublic: true,
        usageCount: true,
        updatedAt: true,
      },
    });
  }

  async getTemplates() {
    return this.prisma.agentTeam.findMany({
      where: { isTemplate: true },
      include: {
        agents: {
          orderBy: { order: 'asc' },
          select: { id: true, role: true, systemPrompt: true, order: true },
        },
        connections: {
          select: { id: true, fromAgentId: true, toAgentId: true },
        },
        _count: { select: { runs: true } },
      },
      orderBy: { category: 'asc' },
    });
  }

  async updateTemplate(
    templateId: string,
    data: {
      name?: string;
      description?: string;
      goal?: string;
      model?: string;
      category?: string;
    },
  ) {
    const tpl = await this.prisma.agentTeam.findUnique({
      where: { id: templateId },
    });
    if (!tpl || !tpl.isTemplate)
      throw new NotFoundException('Template not found');

    return this.prisma.agentTeam.update({
      where: { id: templateId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.goal && { goal: data.goal }),
        ...(data.model && { model: data.model }),
        ...(data.category && { category: data.category }),
      },
    });
  }

  async getRecentRuns(limit = 20) {
    return this.prisma.agentRun.findMany({
      select: {
        id: true,
        goal: true,
        model: true,
        status: true,
        totalTokensUsed: true,
        createdAt: true,
        completedAt: true,
        user: { select: { email: true, name: true, plan: true } },
        team: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getApiCredits() {
    const credits: {
      openRouter: {
        usage: number;
        limit: number | null;
        remaining: number | null;
        expiresAt: string | null;
      } | null;
      openAi: { status: string; note: string } | null;
    } = { openRouter: null, openAi: null };

    // OpenRouter balance
    const orKey = this.configService.get<string>('OPENROUTER_PLATFORM_KEY');
    if (orKey) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${orKey}` },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            data: {
              usage: number;
              limit: number | null;
              limit_remaining: number | null;
              expires_at: string | null;
            };
          };
          credits.openRouter = {
            usage: data.data.usage,
            limit: data.data.limit,
            remaining: data.data.limit_remaining,
            expiresAt: data.data.expires_at,
          };
        }
      } catch (err: unknown) {
        this.logger.error({ err }, 'Failed to fetch OpenRouter credits');
      }
    }

    // OpenAI — their billing API requires a session key (browser-only)
    // We can only report whether the key is valid
    const oaiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (oaiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${oaiKey}` },
        });
        credits.openAi = {
          status: res.ok ? 'active' : 'invalid_or_expired',
          note: res.ok
            ? 'Key is valid. Check billing at platform.openai.com/usage'
            : 'Key may be invalid or expired. Check at platform.openai.com',
        };
      } catch {
        credits.openAi = {
          status: 'unreachable',
          note: 'Could not reach OpenAI API',
        };
      }
    }

    return credits;
  }
}
