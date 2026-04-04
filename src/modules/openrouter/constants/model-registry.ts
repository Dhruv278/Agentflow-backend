import type { Plan } from '@prisma/client';

export const MODEL_REGISTRY: Record<Plan, readonly string[]> = {
  FREE: ['mistralai/mistral-small-3.1-24b-instruct'],
  PRO: [
    'mistralai/mistral-small-3.1-24b-instruct',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-haiku',
    'anthropic/claude-3-haiku',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.1-70b-instruct',
  ],
  BYOK: [
    'mistralai/mistral-small-3.1-24b-instruct',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-haiku',
    'anthropic/claude-3-haiku',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.1-70b-instruct',
  ],
} as const;

export const DEFAULT_MODEL: Record<Plan, string> = {
  FREE: 'mistralai/mistral-small-3.1-24b-instruct',
  PRO: 'openai/gpt-4o-mini',
  BYOK: 'openai/gpt-4o-mini',
};

export const MAX_TOKENS_PER_STEP: Record<Plan, number> = {
  FREE: 2048,
  PRO: 4096,
  BYOK: 8192,
};

export const TOKEN_BUDGET_PER_RUN: Record<Plan, number> = {
  FREE: 10_000,
  PRO: 50_000,
  BYOK: 200_000,
};

export const MONTHLY_RUN_LIMIT: Record<Plan, number> = {
  FREE: 10,
  PRO: 500,
  BYOK: Infinity,
};

export const CONCURRENT_RUN_LIMIT: Record<Plan, number> = {
  FREE: 1,
  PRO: 5,
  BYOK: Infinity,
};

export const TEAM_LIMIT: Record<Plan, number> = {
  FREE: 1,
  PRO: 10,
  BYOK: Infinity,
};

export const MAX_AGENTS_PER_TEAM = 10;

export const STEP_TIMEOUT_MS = 120_000;
export const RUN_TIMEOUT_MS = 600_000;
