import 'dotenv/config';
import { PrismaClient, type AgentRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { AGENT_PROMPTS } from './agent-prompts.js';

const adapter = new PrismaPg(process.env['DATABASE_URL']!);
const prisma = new PrismaClient({ adapter });

// ─── Library Agent Definitions ───
const LIBRARY_AGENTS: {
  name: string;
  description: string;
  role: AgentRole;
  category: string;
}[] = [
  { name: 'Tech News Researcher', description: 'Finds the latest technical news and developments on any topic', role: 'RESEARCHER', category: 'Research' },
  { name: 'General Researcher', description: 'Gathers comprehensive factual information on any given topic', role: 'RESEARCHER', category: 'Research' },
  { name: 'Market Researcher', description: 'Analyzes market dynamics, competitors, and business opportunities', role: 'RESEARCHER', category: 'Research' },
  { name: 'LinkedIn Copywriter', description: 'Writes engaging LinkedIn posts that drive professional engagement', role: 'WRITER', category: 'Content' },
  { name: 'Blog Writer', description: 'Writes clear, engaging blog articles from research or outlines', role: 'WRITER', category: 'Content' },
  { name: 'Email Writer', description: 'Writes persuasive, personalized cold emails that get replies', role: 'WRITER', category: 'Sales' },
  { name: 'Coder', description: 'Writes clean, production-ready code from specifications', role: 'CODER', category: 'Dev' },
  { name: 'Code Reviewer', description: 'Reviews code for bugs, security issues, and improvements', role: 'REVIEWER', category: 'Dev' },
  { name: "Devil's Advocate", description: 'Finds weaknesses, risks, and flawed assumptions in plans', role: 'CRITIC', category: 'Strategy' },
  { name: 'Summarizer', description: 'Compresses long content into concise, actionable bullet points', role: 'WRITER', category: 'Content' },
];

// ─── Template Definitions ───
interface TemplateAgent {
  name: string;
  role: AgentRole;
  prompt: string;
  order: number;
}
interface TemplateDef {
  name: string;
  description: string;
  goal: string;
  category: string;
  model: string;
  agents: TemplateAgent[];
  connections: [number, number][]; // [fromIndex, toIndex]
}

const FREE_MODEL = 'mistralai/mistral-small-3.1-24b-instruct';

const TEMPLATES: TemplateDef[] = [
  // ─── Free-tier templates (use Mistral model) ───
  {
    name: 'Quick Research Summary',
    description: 'Research any topic and get a concise summary with key takeaways.',
    goal: 'Research and summarize: {topic}',
    category: 'Research',
    model: FREE_MODEL,
    agents: [
      { name: 'Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['General Researcher'], order: 1 },
      { name: 'Summarizer', role: 'WRITER', prompt: AGENT_PROMPTS['Summarizer'], order: 2 },
    ],
    connections: [[0, 1]],
  },
  {
    name: 'Simple Blog Draft',
    description: 'Research a topic and write a blog post draft.',
    goal: 'Write a blog post about {topic}',
    category: 'Content',
    model: FREE_MODEL,
    agents: [
      { name: 'Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['Tech News Researcher'], order: 1 },
      { name: 'Writer', role: 'WRITER', prompt: AGENT_PROMPTS['Blog Writer'], order: 2 },
    ],
    connections: [[0, 1]],
  },
  {
    name: 'Idea Critic',
    description: 'Present your idea and get honest feedback on weaknesses and risks.',
    goal: 'Critically evaluate this idea: {topic}',
    category: 'Strategy',
    model: FREE_MODEL,
    agents: [
      { name: 'Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['General Researcher'], order: 1 },
      { name: 'Critic', role: 'CRITIC', prompt: AGENT_PROMPTS["Devil's Advocate"], order: 2 },
    ],
    connections: [[0, 1]],
  },
  // ─── Pro/BYOK templates ───
  {
    name: 'Competitor Analysis',
    description: 'Research competitors, analyze their strategies, write a report, and review it.',
    goal: 'Analyze the competitive landscape for {topic}',
    category: 'Research',
    model: 'openai/gpt-4o-mini',
    agents: [
      { name: 'Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['General Researcher'], order: 1 },
      { name: 'Analyst', role: 'CRITIC', prompt: AGENT_PROMPTS["Devil's Advocate"], order: 2 },
      { name: 'Writer', role: 'WRITER', prompt: AGENT_PROMPTS['Blog Writer'], order: 3 },
      { name: 'Reviewer', role: 'REVIEWER', prompt: AGENT_PROMPTS['Code Reviewer'], order: 4 },
    ],
    connections: [[0, 1], [1, 2], [2, 3]],
  },
  {
    name: 'LinkedIn Post Writer',
    description: 'Research a topic, craft a LinkedIn post, and optimize the hook.',
    goal: 'Write a viral LinkedIn post about {topic}',
    category: 'Content',
    model: 'openai/gpt-4o-mini',
    agents: [
      { name: 'Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['General Researcher'], order: 1 },
      { name: 'Copywriter', role: 'WRITER', prompt: AGENT_PROMPTS['LinkedIn Copywriter'], order: 2 },
      { name: 'Hook Writer', role: 'WRITER', prompt: AGENT_PROMPTS['Summarizer'], order: 3 },
    ],
    connections: [[0, 1], [1, 2]],
  },
  {
    name: 'Feature Builder',
    description: 'Write specs, code the feature, write tests, and review everything.',
    goal: 'Build a complete feature for {topic}',
    category: 'Dev',
    model: 'openai/gpt-4o-mini',
    agents: [
      { name: 'Spec Writer', role: 'WRITER', prompt: AGENT_PROMPTS['Blog Writer'], order: 1 },
      { name: 'Coder', role: 'CODER', prompt: AGENT_PROMPTS['Coder'], order: 2 },
      { name: 'Test Writer', role: 'CODER', prompt: AGENT_PROMPTS['Coder'], order: 3 },
      { name: 'Code Reviewer', role: 'REVIEWER', prompt: AGENT_PROMPTS['Code Reviewer'], order: 4 },
    ],
    connections: [[0, 1], [1, 2], [2, 3]],
  },
  {
    name: 'Cold Email Writer',
    description: 'Research the prospect, write a personalized email, and refine the personalization.',
    goal: 'Write a cold email to {topic}',
    category: 'Sales',
    model: 'openai/gpt-4o-mini',
    agents: [
      { name: 'Prospect Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['General Researcher'], order: 1 },
      { name: 'Email Writer', role: 'WRITER', prompt: AGENT_PROMPTS['Email Writer'], order: 2 },
      { name: 'Personalizer', role: 'REVIEWER', prompt: AGENT_PROMPTS['Summarizer'], order: 3 },
    ],
    connections: [[0, 1], [1, 2]],
  },
  {
    name: 'Business Idea Validator',
    description: 'Research the market, challenge assumptions, and build a strategy.',
    goal: 'Validate the business idea: {topic}',
    category: 'Strategy',
    model: 'openai/gpt-4o-mini',
    agents: [
      { name: 'Market Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['Market Researcher'], order: 1 },
      { name: "Devil's Advocate", role: 'CRITIC', prompt: AGENT_PROMPTS["Devil's Advocate"], order: 2 },
      { name: 'Strategist', role: 'WRITER', prompt: AGENT_PROMPTS['Blog Writer'], order: 3 },
    ],
    connections: [[0, 1], [1, 2]],
  },
  {
    name: 'Blog Post Writer',
    description: 'Research SEO keywords, outline, write, and optimize the article.',
    goal: 'Write an SEO-optimized blog post about {topic}',
    category: 'SEO',
    model: 'openai/gpt-4o-mini',
    agents: [
      { name: 'SEO Researcher', role: 'RESEARCHER', prompt: AGENT_PROMPTS['Tech News Researcher'], order: 1 },
      { name: 'Outliner', role: 'WRITER', prompt: AGENT_PROMPTS['Summarizer'], order: 2 },
      { name: 'Writer', role: 'WRITER', prompt: AGENT_PROMPTS['Blog Writer'], order: 3 },
      { name: 'SEO Editor', role: 'REVIEWER', prompt: AGENT_PROMPTS['Code Reviewer'], order: 4 },
    ],
    connections: [[0, 1], [1, 2], [2, 3]],
  },
];

async function main(): Promise<void> {
  const devPasswordHash = await bcrypt.hash('password123', 12);

  // ─── Seed Users ───
  const freeUser = await prisma.user.upsert({
    where: { email: 'free@dev.local' },
    update: {},
    create: { email: 'free@dev.local', name: 'Free Dev User', passwordHash: devPasswordHash, plan: 'FREE', status: 'ACTIVE' },
  });
  const proUser = await prisma.user.upsert({
    where: { email: 'pro@dev.local' },
    update: {},
    create: { email: 'pro@dev.local', name: 'Pro Dev User', passwordHash: devPasswordHash, plan: 'PRO', status: 'ACTIVE' },
  });
  const byokUser = await prisma.user.upsert({
    where: { email: 'byok@dev.local' },
    update: {},
    create: { email: 'byok@dev.local', name: 'BYOK Dev User', passwordHash: devPasswordHash, plan: 'BYOK', status: 'ACTIVE' },
  });
  console.log('Seeded users:', { free: freeUser.email, pro: proUser.email, byok: byokUser.email });

  // ─── Seed Agent Library ───
  for (const lib of LIBRARY_AGENTS) {
    const existing = await prisma.agentLibraryItem.findFirst({
      where: { name: lib.name, isPublic: true },
    });
    if (!existing) {
      await prisma.agentLibraryItem.create({
        data: {
          name: lib.name,
          description: lib.description,
          role: lib.role,
          systemPrompt: AGENT_PROMPTS[lib.name] ?? 'PROMPT_PENDING',
          category: lib.category,
          isPublic: true,
          createdByUserId: null,
        },
      });
    }
  }
  const libraryCount = await prisma.agentLibraryItem.count({ where: { isPublic: true } });
  console.log(`Seeded ${libraryCount} agent library items`);

  // ─── Seed Templates ───
  for (const tpl of TEMPLATES) {
    const existing = await prisma.agentTeam.findFirst({
      where: { name: tpl.name, isTemplate: true },
    });
    if (existing) continue;

    const team = await prisma.agentTeam.create({
      data: {
        userId: null,
        name: tpl.name,
        description: tpl.description,
        goal: tpl.goal,
        model: tpl.model,
        isTemplate: true,
        isPublic: true,
        category: tpl.category,
        createdByUserId: null,
        agents: {
          create: tpl.agents.map((a) => ({
            role: a.role,
            systemPrompt: a.prompt,
            order: a.order,
            enabled: true,
          })),
        },
      },
      include: { agents: { orderBy: { order: 'asc' } } },
    });

    // Seed connections
    for (const [fromIdx, toIdx] of tpl.connections) {
      const fromAgent = team.agents[fromIdx];
      const toAgent = team.agents[toIdx];
      if (fromAgent && toAgent) {
        await prisma.agentConnection.create({
          data: {
            teamId: team.id,
            fromAgentId: fromAgent.id,
            toAgentId: toAgent.id,
            inputKey: 'output',
          },
        });
      }
    }

    console.log(`Seeded template: ${tpl.name} (${team.agents.length} agents, ${tpl.connections.length} connections)`);
  }

  // ─── Seed PRO user team (legacy) ───
  const existingTeam = await prisma.agentTeam.findFirst({
    where: { userId: proUser.id, name: 'Research & Write Team' },
  });
  if (!existingTeam) {
    await prisma.agentTeam.create({
      data: {
        userId: proUser.id,
        name: 'Research & Write Team',
        description: 'A team that researches a topic, writes content, then reviews it.',
        goal: 'Research and write a comprehensive article about {topic}',
        model: 'openai/gpt-4o-mini',
        agents: {
          create: [
            { role: 'RESEARCHER', systemPrompt: AGENT_PROMPTS['General Researcher'], order: 1, enabled: true },
            { role: 'WRITER', systemPrompt: AGENT_PROMPTS['Blog Writer'], order: 2, enabled: true },
            { role: 'REVIEWER', systemPrompt: AGENT_PROMPTS['Code Reviewer'], order: 3, enabled: true },
          ],
        },
      },
    });
    console.log('Seeded PRO user team: Research & Write Team');
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e: unknown) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
