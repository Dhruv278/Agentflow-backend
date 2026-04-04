import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service.js';
import { StripePaymentProvider } from './providers/stripe-payment.provider.js';
import { RazorpayPaymentProvider } from './providers/razorpay-payment.provider.js';
import type { PaymentProvider } from './providers/payment-provider.interface.js';
import type { PaymentProvider as PaymentProviderEnum } from '@prisma/client';

const REDIS_KEY = 'config:active_payment_provider';

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly stripeProvider: StripePaymentProvider,
    private readonly razorpayProvider: RazorpayPaymentProvider,
  ) {}

  async getActiveProvider(): Promise<PaymentProvider> {
    let providerName: string;

    try {
      const redisValue = await this.redisService.get(REDIS_KEY);
      providerName =
        redisValue ??
        this.configService.get<string>('PAYMENT_PROVIDER_DEFAULT', 'razorpay');
    } catch {
      this.logger.warn('Redis unavailable, using env var for payment provider');
      providerName = this.configService.get<string>(
        'PAYMENT_PROVIDER_DEFAULT',
        'razorpay',
      );
    }

    return this.getProviderByName(providerName as 'stripe' | 'razorpay');
  }

  getProviderByName(name: 'stripe' | 'razorpay'): PaymentProvider {
    if (name === 'stripe') return this.stripeProvider;
    if (name === 'razorpay') return this.razorpayProvider;
    throw new BadRequestException(`Unknown payment provider: ${name}`);
  }

  getProviderForSubscription(provider: PaymentProviderEnum): PaymentProvider {
    return provider === 'STRIPE' ? this.stripeProvider : this.razorpayProvider;
  }

  getRazorpayProvider(): RazorpayPaymentProvider {
    return this.razorpayProvider;
  }

  async getActiveProviderName(): Promise<string> {
    try {
      const redisValue = await this.redisService.get(REDIS_KEY);
      return (
        redisValue ??
        this.configService.get<string>('PAYMENT_PROVIDER_DEFAULT', 'razorpay')
      );
    } catch {
      return this.configService.get<string>(
        'PAYMENT_PROVIDER_DEFAULT',
        'razorpay',
      );
    }
  }

  async setActiveProvider(name: 'stripe' | 'razorpay'): Promise<void> {
    await this.redisService.set(REDIS_KEY, name);
    this.logger.log({ provider: name }, 'Active payment provider updated');
  }
}
