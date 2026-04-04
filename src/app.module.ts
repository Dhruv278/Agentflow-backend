import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { KeyVaultModule } from './modules/key-vault/key-vault.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { OpenRouterModule } from './modules/openrouter/openrouter.module.js';
import { MemoryModule } from './modules/memory/memory.module.js';
import { AgentRunsModule } from './modules/agent-runs/agent-runs.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        autoLogging: true,
        serializers: {
          req(req: Record<string, unknown>) {
            return {
              method: req['method'],
              url: req['url'],
              remoteAddress: req['remoteAddress'],
            };
          },
          res(res: Record<string, unknown>) {
            return { statusCode: res['statusCode'] };
          },
        },
        redact: [
          'req.headers.authorization',
          'apiKey',
          'req.body.key',
          'stripeCustomerId',
          'stripeSubscriptionId',
          'razorpayCustomerId',
          'razorpaySubscriptionId',
        ],
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    BullModule.forRoot({
      connection: (() => {
        const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
        const parsed = new URL(url);
        return {
          host: parsed.hostname,
          port: parseInt(parsed.port || '6379', 10),
          password: parsed.password || undefined,
          username: parsed.username !== 'default' ? parsed.username : undefined,
        };
      })(),
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    KeyVaultModule,
    BillingModule,
    OpenRouterModule,
    MemoryModule,
    AgentRunsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
