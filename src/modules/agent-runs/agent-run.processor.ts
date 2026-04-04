import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AgentRunnerService } from './agent-runner.service.js';
import type { Plan } from '@prisma/client';

export interface AgentRunJobData {
  runId: string;
  teamId: string;
  goal: string;
  apiKey: string;
  model: string;
  plan: Plan;
}

export const AGENT_RUN_QUEUE = 'agent-runs';

@Processor(AGENT_RUN_QUEUE, {
  concurrency: 5,
})
export class AgentRunProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentRunProcessor.name);

  constructor(private readonly runner: AgentRunnerService) {
    super();
  }

  async process(job: Job<AgentRunJobData>): Promise<void> {
    const { runId, teamId, goal, apiKey, model, plan } = job.data;

    this.logger.log({ runId, teamId, model }, 'Processing agent run job');

    await this.runner.runPipeline(runId, teamId, goal, apiKey, model, plan);

    this.logger.log({ runId }, 'Agent run job completed');
  }
}
