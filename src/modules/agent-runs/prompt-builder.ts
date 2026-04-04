import type { AgentRole } from '@prisma/client';
import type { MemoryResult } from '../memory/memory.service.js';

const PLATFORM_INSTRUCTION = `[PLATFORM CONTEXT]
You are an AI agent in the AgentFlow platform. Follow your role instructions below exactly.
[END PLATFORM CONTEXT]`;

const MAX_PREVIOUS_OUTPUT_LENGTH = 10_000;
const MAX_MEMORY_LENGTH = 500;
const MAX_MEMORIES = 3;

interface PreviousOutput {
  role: AgentRole;
  output: string;
}

export function buildSystemPrompt(
  agentRole: AgentRole,
  userSystemPrompt: string,
  previousOutputs: PreviousOutput[],
  memories: MemoryResult[],
): string {
  const parts: string[] = [PLATFORM_INSTRUCTION];

  parts.push(`\n[AGENT ROLE: ${agentRole}]`);
  parts.push(sanitizeInput(userSystemPrompt));

  if (previousOutputs.length > 0) {
    parts.push('\n--- Previous agent outputs ---');
    for (const prev of previousOutputs) {
      const truncated = prev.output.slice(0, MAX_PREVIOUS_OUTPUT_LENGTH);
      parts.push(`[Output from ${prev.role}]: ${truncated} [End output]`);
    }
    parts.push('---');
  }

  const cappedMemories = memories.slice(0, MAX_MEMORIES);
  if (cappedMemories.length > 0) {
    parts.push('\n--- Relevant past context ---');
    for (const mem of cappedMemories) {
      parts.push(mem.text.slice(0, MAX_MEMORY_LENGTH));
    }
    parts.push('---');
  }

  return parts.join('\n');
}

export function buildUserMessage(goal: string): string {
  return sanitizeInput(goal);
}

export function sanitizeInput(text: string): string {
  // Strip control characters except newline (\n) and tab (\t)
  let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Collapse excessive newlines (max 3 consecutive)
  sanitized = sanitized.replace(/\n{4,}/g, '\n\n\n');

  return sanitized;
}

export function sanitizeOutput(text: string): string {
  // Redact patterns that look like API keys
  let sanitized = text.replace(
    /\b(sk-[a-zA-Z0-9_-]{20,}|rzp_[a-zA-Z0-9_]{10,}|whsec_[a-zA-Z0-9_]{10,}|pcsk_[a-zA-Z0-9_]{10,})\b/g,
    '[REDACTED]',
  );

  // Redact known env var names if they appear with values
  const sensitiveVarNames = [
    'VAULT_SECRET',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'OPENROUTER_PLATFORM_KEY',
    'OPENAI_API_KEY',
    'PINECONE_API_KEY',
    'DATABASE_URL',
  ];

  for (const varName of sensitiveVarNames) {
    const regex = new RegExp(`${varName}\\s*[=:]\\s*\\S+`, 'gi');
    sanitized = sanitized.replace(regex, `${varName}=[REDACTED]`);
  }

  return sanitized;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+a?\s*new\s+role/i,
  /^system:/im,
  /\[PLATFORM\s+INSTRUCTION/i,
  /\[END\s+PLATFORM\s+INSTRUCTION\]/i,
];

export function detectInjectionAttempt(text: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.source;
    }
  }
  return null;
}
