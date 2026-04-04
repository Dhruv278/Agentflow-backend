import { Injectable, Logger } from '@nestjs/common';

export interface MemoryResult {
  text: string;
  score: number;
}

/**
 * Stub implementation. Phase 17 will replace with real Pinecone + OpenAI embeddings:
 * - recallRelevant: embed query via OpenAI → query Pinecone by userId namespace → top 3 results (max 500 chars each)
 * - saveOutput: embed text via OpenAI → upsert to Pinecone with { userId, runId, role, text, createdAt }
 * - deleteByRunId: remove all vectors for a run from Pinecone
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  async recallRelevant(
    _query: string,
    _userId: string,
    _topK = 3,
  ): Promise<MemoryResult[]> {
    this.logger.debug(
      'MemoryService.recallRelevant called (stub — returning empty)',
    );
    return [];
  }

  async saveOutput(
    _runId: string,
    _output: string,
    _userId: string,
  ): Promise<void> {
    this.logger.debug('MemoryService.saveOutput called (stub — no-op)');
  }

  async deleteByRunId(_runId: string): Promise<void> {
    this.logger.debug('MemoryService.deleteByRunId called (stub — no-op)');
  }
}
