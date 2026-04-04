import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PaymentGatewayService } from '../payment-gateway.service';
import { StripePaymentProvider } from '../providers/stripe-payment.provider';
import { RazorpayPaymentProvider } from '../providers/razorpay-payment.provider';
import { RedisService } from '../../redis/redis.service';

describe('PaymentGatewayService', () => {
  let service: PaymentGatewayService;
  let redisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let stripeProvider: Partial<StripePaymentProvider>;
  let razorpayProvider: Partial<RazorpayPaymentProvider>;

  beforeEach(async () => {
    redisService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    configService = {
      get: jest.fn().mockReturnValue('razorpay'),
      getOrThrow: jest.fn(),
    };
    stripeProvider = { providerName: 'stripe' as const };
    razorpayProvider = { providerName: 'razorpay' as const };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentGatewayService,
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
        { provide: StripePaymentProvider, useValue: stripeProvider },
        { provide: RazorpayPaymentProvider, useValue: razorpayProvider },
      ],
    }).compile();

    service = module.get(PaymentGatewayService);
  });

  describe('getActiveProvider', () => {
    it('should return razorpay when Redis has "razorpay"', async () => {
      redisService.get.mockResolvedValue('razorpay');
      const provider = await service.getActiveProvider();
      expect(provider.providerName).toBe('razorpay');
    });

    it('should return stripe when Redis has "stripe"', async () => {
      redisService.get.mockResolvedValue('stripe');
      const provider = await service.getActiveProvider();
      expect(provider.providerName).toBe('stripe');
    });

    it('should fall back to env var when Redis returns null', async () => {
      redisService.get.mockResolvedValue(null);
      configService.get.mockReturnValue('stripe');
      const provider = await service.getActiveProvider();
      expect(provider.providerName).toBe('stripe');
    });

    it('should fall back to env var when Redis throws', async () => {
      redisService.get.mockRejectedValue(new Error('Redis down'));
      configService.get.mockReturnValue('stripe');
      const provider = await service.getActiveProvider();
      expect(provider.providerName).toBe('stripe');
    });

    it('should default to razorpay when Redis null and no env var', async () => {
      redisService.get.mockResolvedValue(null);
      configService.get.mockReturnValue('razorpay');
      const provider = await service.getActiveProvider();
      expect(provider.providerName).toBe('razorpay');
    });
  });

  describe('getProviderByName', () => {
    it('should return stripe provider for "stripe"', () => {
      const provider = service.getProviderByName('stripe');
      expect(provider.providerName).toBe('stripe');
    });

    it('should return razorpay provider for "razorpay"', () => {
      const provider = service.getProviderByName('razorpay');
      expect(provider.providerName).toBe('razorpay');
    });

    it('should throw BadRequestException for unknown provider', () => {
      expect(() =>
        service.getProviderByName('paypal' as 'stripe' | 'razorpay'),
      ).toThrow(BadRequestException);
    });
  });

  describe('getProviderForSubscription', () => {
    it('should return stripe provider for STRIPE enum', () => {
      const provider = service.getProviderForSubscription('STRIPE');
      expect(provider.providerName).toBe('stripe');
    });

    it('should return razorpay provider for RAZORPAY enum', () => {
      const provider = service.getProviderForSubscription('RAZORPAY');
      expect(provider.providerName).toBe('razorpay');
    });
  });

  describe('setActiveProvider', () => {
    it('should write to Redis', async () => {
      await service.setActiveProvider('stripe');
      expect(redisService.set).toHaveBeenCalledWith(
        'config:active_payment_provider',
        'stripe',
      );
    });
  });

  describe('getActiveProviderName', () => {
    it('should return redis value when available', async () => {
      redisService.get.mockResolvedValue('stripe');
      const name = await service.getActiveProviderName();
      expect(name).toBe('stripe');
    });

    it('should return env var when redis returns null', async () => {
      redisService.get.mockResolvedValue(null);
      configService.get.mockReturnValue('razorpay');
      const name = await service.getActiveProviderName();
      expect(name).toBe('razorpay');
    });

    it('should return env var when redis throws', async () => {
      redisService.get.mockRejectedValue(new Error('down'));
      configService.get.mockReturnValue('stripe');
      const name = await service.getActiveProviderName();
      expect(name).toBe('stripe');
    });
  });
});
