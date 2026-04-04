import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { BillingService } from '../billing.service';
import { PaymentGatewayService } from '../payment-gateway.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('BillingService', () => {
  let service: BillingService;
  let prisma: Record<string, any>;
  let gateway: Record<string, any>;
  let configService: Record<string, any>;

  const mockStripeProvider = {
    providerName: 'stripe' as const,
    createCustomer: jest.fn().mockResolvedValue('cus_stripe_123'),
    createCheckoutSession: jest.fn().mockResolvedValue({
      type: 'redirect',
      url: 'https://checkout.stripe.com/xxx',
    }),
    createPortalSession: jest
      .fn()
      .mockResolvedValue('https://billing.stripe.com/portal'),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
  };

  const mockRazorpayProvider = {
    providerName: 'razorpay' as const,
    createCustomer: jest.fn().mockResolvedValue('cust_razorpay_123'),
    createCheckoutSession: jest.fn().mockResolvedValue({
      type: 'modal',
      subscriptionId: 'sub_rzp_456',
      keyId: 'rzp_test_key',
      prefill: { name: 'Test User', email: 'test@example.com' },
    }),
    createPortalSession: jest.fn().mockResolvedValue(null),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    verifyPaymentSignature: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };

    gateway = {
      getActiveProvider: jest.fn().mockResolvedValue(mockRazorpayProvider),
      getProviderByName: jest.fn((name: string) =>
        name === 'stripe' ? mockStripeProvider : mockRazorpayProvider,
      ),
      getProviderForSubscription: jest.fn((p: string) =>
        p === 'STRIPE' ? mockStripeProvider : mockRazorpayProvider,
      ),
      getRazorpayProvider: jest.fn().mockReturnValue(mockRazorpayProvider),
      getActiveProviderName: jest.fn().mockResolvedValue('razorpay'),
      setActiveProvider: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn().mockReturnValue('admin@example.com'),
      getOrThrow: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentGatewayService, useValue: gateway },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createCheckoutSession', () => {
    it('should return modal result when Razorpay is active and user has no customer ID', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Test User',
        stripeCustomerId: null,
        razorpayCustomerId: null,
      });

      const result = await service.createCheckoutSession(
        'user-1',
        'test@example.com',
        'PRO',
      );

      expect(result.type).toBe('modal');
      expect(mockRazorpayProvider.createCustomer).toHaveBeenCalledWith(
        'user-1',
        'test@example.com',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { razorpayCustomerId: 'cust_razorpay_123' },
      });
    });

    it('should reuse existing Razorpay customer ID', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Test User',
        stripeCustomerId: null,
        razorpayCustomerId: 'cust_existing',
      });

      await service.createCheckoutSession('user-1', 'test@example.com', 'PRO');

      expect(mockRazorpayProvider.createCustomer).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should return redirect result when Stripe is active', async () => {
      gateway.getActiveProvider.mockResolvedValue(mockStripeProvider);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Test User',
        stripeCustomerId: 'cus_existing',
        razorpayCustomerId: null,
      });

      const result = await service.createCheckoutSession(
        'user-1',
        'test@example.com',
        'PRO',
      );

      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.url).toContain('stripe.com');
      }
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createCheckoutSession('nonexistent', 'x@y.com', 'PRO'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPortalSession', () => {
    it('should return Stripe portal URL for Stripe subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        provider: 'STRIPE',
        stripeCustomerId: 'cus_123',
      });
      prisma.user.findUnique.mockResolvedValue({
        stripeCustomerId: 'cus_123',
      });

      const result = await service.createPortalSession('user-1');
      expect(result.url).toContain('stripe.com');
      expect(result.provider).toBe('STRIPE');
    });

    it('should return null URL for Razorpay subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        provider: 'RAZORPAY',
      });

      const result = await service.createPortalSession('user-1');
      expect(result.url).toBeNull();
      expect(result.provider).toBe('RAZORPAY');
    });

    it('should throw when no active subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.createPortalSession('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel Razorpay subscription at period end', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        provider: 'RAZORPAY',
        razorpaySubscriptionId: 'sub_rzp_123',
        stripeSubscriptionId: null,
      });

      await service.cancelSubscription('user-1');

      expect(mockRazorpayProvider.cancelSubscription).toHaveBeenCalledWith(
        'sub_rzp_123',
        true,
      );
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { cancelAtPeriodEnd: true },
      });
    });

    it('should cancel Stripe subscription at period end', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        provider: 'STRIPE',
        stripeSubscriptionId: 'sub_stripe_123',
        razorpaySubscriptionId: null,
      });

      await service.cancelSubscription('user-1');

      expect(mockStripeProvider.cancelSubscription).toHaveBeenCalledWith(
        'sub_stripe_123',
        true,
      );
    });

    it('should throw NotFoundException when no active subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.cancelSubscription('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when subscription has no provider ID', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        provider: 'RAZORPAY',
        razorpaySubscriptionId: null,
        stripeSubscriptionId: null,
      });

      await expect(service.cancelSubscription('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getSubscription', () => {
    it('should return subscription with provider field', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-05-01'),
        cancelAtPeriodEnd: false,
        provider: 'RAZORPAY',
        createdAt: new Date('2026-04-01'),
      });

      const result = await service.getSubscription('user-1');
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('RAZORPAY');
      expect(result!.plan).toBe('PRO');
    });

    it('should return null when no subscription exists', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      const result = await service.getSubscription('user-1');
      expect(result).toBeNull();
    });
  });

  describe('setActiveProvider', () => {
    it('should allow admin to set provider', async () => {
      configService.get.mockReturnValue('admin@example.com');

      await service.setActiveProvider('stripe', 'admin@example.com');

      expect(gateway.setActiveProvider).toHaveBeenCalledWith('stripe');
    });

    it('should throw ForbiddenException for non-admin email', async () => {
      configService.get.mockReturnValue('admin@example.com');

      await expect(
        service.setActiveProvider('stripe', 'hacker@evil.com'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should handle case-insensitive admin email comparison', async () => {
      configService.get.mockReturnValue('Admin@Example.COM');

      await service.setActiveProvider('stripe', 'admin@example.com');

      expect(gateway.setActiveProvider).toHaveBeenCalledWith('stripe');
    });
  });

  describe('verifyRazorpayPayment', () => {
    it('should delegate to razorpay provider', () => {
      const result = service.verifyRazorpayPayment('pay_1', 'sub_1', 'sig_1');
      expect(mockRazorpayProvider.verifyPaymentSignature).toHaveBeenCalledWith(
        'pay_1',
        'sub_1',
        'sig_1',
      );
      expect(result).toBe(true);
    });
  });

  describe('getActiveProvider', () => {
    it('should delegate to gateway', async () => {
      const result = await service.getActiveProvider();
      expect(result).toBe('razorpay');
    });
  });
});
