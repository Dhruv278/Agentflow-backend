import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AgentRunnerService } from './agent-runner.service.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AgentRunProcessor, AGENT_RUN_QUEUE } from './agent-run.processor.js';
import { AgentTeamsController } from './agent-teams.controller.js';
import { AgentRunsController } from './agent-runs.controller.js';
import { AgentLibraryController } from './agent-library.controller.js';
import { TemplatesController } from './templates.controller.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { MemoryModule } from '../memory/memory.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: AGENT_RUN_QUEUE }),
    OpenRouterModule,
    MemoryModule,
  ],
  controllers: [
    AgentTeamsController,
    AgentRunsController,
    AgentLibraryController,
    TemplatesController,
  ],
  providers: [AgentRunnerService, AgentRunsService, AgentRunProcessor],
  exports: [AgentRunsService],
})
export class AgentRunsModule {}
