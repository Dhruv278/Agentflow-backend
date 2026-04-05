import { Injectable, Logger } from '@nestjs/common';
import type { AgentRole, Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OpenRouterService } from '../openrouter/openrouter.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { RedisService } from '../redis/redis.service.js';
import {
  buildSystemPrompt,
  buildUserMessage,
  sanitizeOutput,
  detectInjectionAttempt,
} from './prompt-builder.js';
import { buildDAG, topologicalSort, getParentIds } from './dag-utils.js';
import {
  TOKEN_BUDGET_PER_RUN,
  STEP_TIMEOUT_MS,
  RUN_TIMEOUT_MS,
} from '../openrouter/constants/model-registry.js';

const MAX_OUTPUT_LENGTH = 50_000;
interface CompletedStep {
  agentId: string;
  role: AgentRole;
  output: string;
}

export interface RunEvent {
  event:
    | 'step_start'
    | 'token'
    | 'step_complete'
    | 'run_complete'
    | 'run_error';
  data: Record<string, unknown>;
}

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterService,
    private readonly memoryService: MemoryService,
    private readonly redisService: RedisService,
  ) {}

  async runPipeline(
    runId: string,
    teamId: string,
    goal: string,
    apiKey: string,
    model: string,
    plan: Plan,
  ): Promise<void> {
    const runStart = Date.now();

    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    const agents = await this.prisma.agent.findMany({
      where: { teamId, enabled: true },
      orderBy: { order: 'asc' },
    });

    if (agents.length === 0) {
      await this.completeRun(runId, 0, Date.now() - runStart);
      return;
    }

    // Determine execution order: DAG if connections exist, else sequential
    const connections = await this.prisma.agentConnection.findMany({
      where: { teamId },
    });

    const agentIds = agents.map((a) => a.id);
    let executionOrder: string[];

    if (connections.length > 0) {
      const dag = buildDAG(agentIds, connections);
      executionOrder = topologicalSort(dag);
    } else {
      executionOrder = agentIds;
    }

    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const completedSteps: CompletedStep[] = [];
    let totalTokens = 0;
    const tokenBudget = TOKEN_BUDGET_PER_RUN[plan];

    const injectionPattern = detectInjectionAttempt(goal);
    if (injectionPattern) {
      this.logger.warn(
        { runId, pattern: injectionPattern },
        'Possible prompt injection in goal',
      );
    }

    try {
      for (const agentId of executionOrder) {
        const agent = agentMap.get(agentId);
        if (!agent) continue;

        if (Date.now() - runStart > RUN_TIMEOUT_MS) {
          throw new Error(
            'Run timed out — exceeded maximum duration of 10 minutes',
          );
        }
        if (totalTokens >= tokenBudget) {
          throw new Error(
            `Token budget exceeded (${totalTokens}/${tokenBudget}). Upgrade your plan.`,
          );
        }

        const step = await this.prisma.agentRunStep.create({
          data: {
            runId,
            agentId: agent.id,
            role: agent.role,
            status: 'RUNNING',
          },
        });

        await this.emitEvent(runId, {
          event: 'step_start',
          data: { stepId: step.id, role: agent.role, agentId: agent.id },
        });

        const stepStart = Date.now();

        try {
          const memories = await this.memoryService.recallRelevant(goal, '');

          // Get parent outputs (DAG) or previous outputs (sequential)
          let previousOutputs: { role: AgentRole; output: string }[];
          if (connections.length > 0) {
            const dag = buildDAG(agentIds, connections);
            const parentIds = getParentIds(dag, agentId);
            previousOutputs = completedSteps
              .filter((s) => parentIds.includes(s.agentId))
              .map((s) => ({ role: s.role, output: s.output }));
          } else {
            previousOutputs = completedSteps.map((s) => ({
              role: s.role,
              output: s.output,
            }));
          }

          // Resolve prompt: from library item or agent's own
          const systemPrompt = await this.openRouter.resolveSystemPrompt(
            agent.id,
          );

          const builtSystemPrompt = buildSystemPrompt(
            agent.role,
            systemPrompt,
            previousOutputs,
            memories,
          );

          const parentOutputText = previousOutputs
            .map((p) => `--- Output from ${p.role} ---\n${p.output}`)
            .join('\n\n');
          const userMessage = buildUserMessage(
            parentOutputText ? `${goal}\n\n${parentOutputText}` : goal,
          );

          const remainingBudget = tokenBudget - totalTokens;
          const maxTokens = Math.min(
            this.openRouter.getMaxTokensForPlan(plan),
            remainingBudget,
          );

          let output = '';
          let stepTokens = 0;

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`Step timed out after ${STEP_TIMEOUT_MS / 1000} seconds`)),
              STEP_TIMEOUT_MS,
            );
          });

          const streamPromise = (async () => {
            const stream = this.openRouter.streamCompletion({
              model,
              systemPrompt: builtSystemPrompt,
              userMessage,
              apiKey,
              maxTokens,
            });
            for await (const token of stream) {
              output += token;
              await this.emitEvent(runId, {
                event: 'token',
                data: { stepId: step.id, token },
              });
            }
            stepTokens = this.openRouter.getLastTokenCount();
          })();

          await Promise.race([streamPromise, timeoutPromise]);

          output = sanitizeOutput(output).slice(0, MAX_OUTPUT_LENGTH);
          const durationMs = Date.now() - stepStart;
          totalTokens += stepTokens;

          await this.prisma.agentRunStep.update({
            where: { id: step.id },
            data: {
              output,
              tokenCount: stepTokens,
              durationMs,
              status: 'COMPLETED',
            },
          });

          await this.emitEvent(runId, {
            event: 'step_complete',
            data: {
              stepId: step.id,
              role: agent.role,
              tokenCount: stepTokens,
              durationMs,
            },
          });

          completedSteps.push({ agentId: agent.id, role: agent.role, output });
        } catch (stepError: unknown) {
          const errorMessage =
            stepError instanceof Error
              ? stepError.message
              : 'Unknown step error';
          await this.prisma.agentRunStep.update({
            where: { id: step.id },
            data: { status: 'FAILED', durationMs: Date.now() - stepStart },
          });
          throw new Error(
            `Agent ${agent.role} (step ${agent.order}) failed: ${errorMessage}`,
          );
        }
      }

      await this.completeRun(runId, totalTokens, Date.now() - runStart);

      const finalOutput = completedSteps[completedSteps.length - 1]?.output;
      if (finalOutput) {
        const run = await this.prisma.agentRun.findUnique({
          where: { id: runId },
          select: { userId: true },
        });
        if (run?.userId)
          await this.memoryService.saveOutput(runId, finalOutput, run.userId);
      }
    } catch (pipelineError: unknown) {
      const errorMessage =
        pipelineError instanceof Error
          ? pipelineError.message
          : 'Unknown pipeline error';
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          totalTokensUsed: totalTokens,
          errorMessage,
        },
      });
      await this.emitEvent(runId, {
        event: 'run_error',
        data: { runId, error: errorMessage },
      });
      this.logger.error(
        { runId, error: errorMessage },
        'Agent pipeline failed',
      );
    }
  }

  private async completeRun(
    runId: string,
    totalTokens: number,
    totalDurationMs: number,
  ): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalTokensUsed: totalTokens,
      },
    });
    await this.emitEvent(runId, {
      event: 'run_complete',
      data: { runId, totalTokens, totalDurationMs },
    });
  }

  private async emitEvent(runId: string, event: RunEvent): Promise<void> {
    try {
      await this.redisService.publish(
        `agent-run:${runId}`,
        JSON.stringify(event),
      );
    } catch (err: unknown) {
      this.logger.error(
        { runId, event: event.event, err },
        'Failed to emit pipeline event',
      );
    }
  }
}
