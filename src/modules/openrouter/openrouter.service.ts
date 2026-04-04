import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { KeyVaultService } from '../key-vault/key-vault.service.js';
import {
  MODEL_REGISTRY,
  MAX_TOKENS_PER_STEP,
} from './constants/model-registry.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface StreamCompletionParams {
  model: string;
  systemPrompt: string;
  userMessage: string;
  apiKey: string;
  maxTokens?: number;
}

export interface StreamCompletionResult {
  stream: AsyncIterable<string>;
  getTokenCount: () => number;
}

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private platformKey!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly keyVaultService: KeyVaultService,
  ) {
    const key = this.configService.get<string>('OPENROUTER_PLATFORM_KEY');
    if (key) {
      this.platformKey = key;
    } else {
      this.logger.warn(
        'OPENROUTER_PLATFORM_KEY not set — FREE plan LLM calls will fail',
      );
    }
  }

  validateModelForUser(model: string, plan: Plan, hasOwnKey: boolean): void {
    // Own key = any model, no restrictions
    if (hasOwnKey) return;

    // Using platform key = restricted to registry
    const allowedModels = MODEL_REGISTRY[plan];
    if (!allowedModels.includes(model)) {
      throw new ForbiddenException(
        `Model "${model}" is not available on the ${plan} plan without your own API key. Add your OpenRouter key in Settings to use any model, or choose from: ${allowedModels.join(', ')}`,
      );
    }
  }

  async resolveApiKey(
    userId: string,
  ): Promise<{ apiKey: string; hasOwnKey: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, encryptedOrKey: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // BYOK must have key
    if (user.plan === 'BYOK') {
      const decryptedKey = await this.keyVaultService.getDecryptedKey(userId);
      if (!decryptedKey) {
        throw new BadRequestException(
          'BYOK plan requires an OpenRouter API key. Add one in Settings.',
        );
      }
      return { apiKey: decryptedKey, hasOwnKey: true };
    }

    // PRO with own key → use their key
    if (user.plan === 'PRO' && user.encryptedOrKey) {
      const decryptedKey = await this.keyVaultService.getDecryptedKey(userId);
      if (decryptedKey) {
        return { apiKey: decryptedKey, hasOwnKey: true };
      }
    }

    // FREE or PRO without key → platform key
    if (!this.platformKey) {
      throw new BadRequestException(
        'Platform API key not configured. Contact support.',
      );
    }

    return { apiKey: this.platformKey, hasOwnKey: false };
  }

  async userHasOwnKey(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { encryptedOrKey: true },
    });
    return !!user?.encryptedOrKey;
  }

  getMaxTokensForPlan(plan: Plan): number {
    return MAX_TOKENS_PER_STEP[plan];
  }

  async resolveSystemPrompt(agentId: string): Promise<string> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { systemPrompt: true, libraryItemId: true },
    });

    if (!agent) {
      throw new BadRequestException('Agent not found');
    }

    if (agent.libraryItemId) {
      const libraryItem = await this.prisma.agentLibraryItem.findUnique({
        where: { id: agent.libraryItemId },
        select: { systemPrompt: true },
      });
      if (libraryItem) return libraryItem.systemPrompt;
    }

    return agent.systemPrompt;
  }

  async *streamCompletion(
    params: StreamCompletionParams,
  ): AsyncIterable<string> & { getTokenCount?: () => number } {
    let tokenCount = 0;
    const maxTokens = params.maxTokens ?? 4096;

    const body = JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userMessage },
      ],
      max_tokens: maxTokens,
      stream: true,
    });

    const response = await this.fetchWithRetry(params.apiKey, body);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      if (response.status === 401) {
        throw new UnauthorizedException(
          'Invalid API key. Check your OpenRouter key in Settings.',
        );
      }
      throw new BadRequestException(
        `OpenRouter API error (${response.status}): ${errorBody.slice(0, 200)}`,
      );
    }

    if (!response.body) {
      throw new BadRequestException('OpenRouter returned empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { total_tokens?: number };
            };

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }

            if (parsed.usage?.total_tokens) {
              tokenCount = parsed.usage.total_tokens;
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Attach token count getter
    (this as unknown as Record<string, unknown>)['_lastTokenCount'] =
      tokenCount;
  }

  getLastTokenCount(): number {
    return (
      ((this as unknown as Record<string, unknown>)[
        '_lastTokenCount'
      ] as number) ?? 0
    );
  }

  private async fetchWithRetry(
    apiKey: string,
    body: string,
    attempt = 1,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.configService.get<string>(
            'APP_URL',
            'http://localhost:3000',
          ),
          'X-Title': 'AgentFlow',
        },
        body,
        signal: controller.signal,
      });

      if (response.status === 429 && attempt <= 1) {
        const delay = attempt * 1000;
        this.logger.warn(
          { attempt, delay },
          'OpenRouter rate limited (429), retrying',
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.fetchWithRetry(apiKey, body, attempt + 1);
      }

      if (response.status >= 500 && attempt <= 1) {
        const delay = 2000;
        this.logger.warn(
          { status: response.status, attempt },
          'OpenRouter server error, retrying',
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.fetchWithRetry(apiKey, body, attempt + 1);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
