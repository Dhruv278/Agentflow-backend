import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentGatewayService } from './payment-gateway.service.js';
import type { SubscriptionResponseDto } from './dto/subscription-response.dto.js';
import type {
  CheckoutResult,
  WebhookResult,
  WebhookSubscriptionData,
  WebhookPaymentData,
} from './providers/payment-provider.interface.js';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private appUrl!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayService,
  ) {
    this.appUrl = this.configService.getOrThrow<string>('APP_URL');
  }

  async createCheckoutSession(
    userId: string,
    email: string,
    plan: 'PRO' | 'BYOK',
  ): Promise<CheckoutResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        stripeCustomerId: true,
        razorpayCustomerId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const provider = await this.gateway.getActiveProvider();

    let customerId =
      provider.providerName === 'stripe'
        ? user.stripeCustomerId
        : user.razorpayCustomerId;

    if (!customerId) {
      customerId = await provider.createCustomer(userId, email);

      const updateField =
        provider.providerName === 'stripe'
          ? { stripeCustomerId: customerId }
          : { razorpayCustomerId: customerId };

      await this.prisma.user.update({
        where: { id: userId },
        data: updateField,
      });
    }

    return provider.createCheckoutSession({
      customerId,
      plan,
      userId,
      email,
      userName: user.name,
      successUrl: `${this.appUrl}/dashboard?upgraded=true`,
      cancelUrl: `${this.appUrl}/pricing`,
    });
  }

  async createPortalSession(
    userId: string,
  ): Promise<{ url: string | null; provider: string }> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: { not: 'CANCELED' } },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new BadRequestException('No active subscription found');
    }

    const provider = this.gateway.getProviderForSubscription(
      subscription.provider,
    );

    if (provider.providerName === 'stripe') {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true },
      });

      if (!user?.stripeCustomerId) {
        throw new BadRequestException('No Stripe customer found');
      }

      const url = await provider.createPortalSession(
        user.stripeCustomerId,
        `${this.appUrl}/billing`,
      );

      return { url, provider: 'STRIPE' };
    }

    return { url: null, provider: 'RAZORPAY' };
  }

  async getSubscription(
    userId: string,
  ): Promise<SubscriptionResponseDto | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return null;
    }

    return {
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      provider: subscription.provider,
      createdAt: subscription.createdAt,
    };
  }

  async cancelSubscription(userId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    const provider = this.gateway.getProviderForSubscription(
      subscription.provider,
    );

    const providerSubId =
      subscription.provider === 'STRIPE'
        ? subscription.stripeSubscriptionId
        : subscription.razorpaySubscriptionId;

    if (!providerSubId) {
      throw new BadRequestException('Subscription ID not found');
    }

    await provider.cancelSubscription(providerSubId, true);

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    });

    this.logger.log(
      { userId, provider: subscription.provider },
      'Subscription cancellation requested',
    );
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const stripeProvider = this.gateway.getProviderByName('stripe');
    const result = await stripeProvider.verifyAndParseWebhook(
      rawBody,
      signature,
    );
    await this.processWebhookResult(result, 'STRIPE');
  }

  async handleRazorpayWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const razorpayProvider = this.gateway.getProviderByName('razorpay');
    const result = await razorpayProvider.verifyAndParseWebhook(
      rawBody,
      signature,
    );
    await this.processWebhookResult(result, 'RAZORPAY');
  }

  verifyRazorpayPayment(
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): boolean {
    const razorpayProvider = this.gateway.getRazorpayProvider();
    return razorpayProvider.verifyPaymentSignature(
      paymentId,
      subscriptionId,
      signature,
    );
  }

  async getActiveProvider(): Promise<string> {
    return this.gateway.getActiveProviderName();
  }

  async setActiveProvider(
    provider: 'stripe' | 'razorpay',
    adminEmail: string,
  ): Promise<void> {
    const adminEmails = this.configService
      .get<string>('ADMIN_EMAILS', '')
      .split(',')
      .map((e) => e.trim().toLowerCase());

    if (!adminEmails.includes(adminEmail.toLowerCase())) {
      throw new ForbiddenException('Not authorized to change payment provider');
    }

    await this.gateway.setActiveProvider(provider);
  }

  private async processWebhookResult(
    result: WebhookResult,
    providerEnum: 'STRIPE' | 'RAZORPAY',
  ): Promise<void> {
    if (result.action === 'ignored' || !result.data) return;

    switch (result.action) {
      case 'subscription_created':
        await this.handleSubscriptionCreated(
          result.data,
          providerEnum,
          result.payment,
        );
        break;
      case 'subscription_updated':
        await this.handleSubscriptionUpdated(
          result.data,
          providerEnum,
          result.payment,
        );
        break;
      case 'subscription_deleted':
        await this.handleSubscriptionDeleted(result.data, providerEnum);
        break;
      case 'payment_failed':
        await this.handlePaymentFailed(result.data, providerEnum);
        break;
    }
  }

  private async handleSubscriptionCreated(
    data: WebhookSubscriptionData,
    providerEnum: 'STRIPE' | 'RAZORPAY',
    payment?: WebhookPaymentData,
  ): Promise<void> {
    const existingByStripe =
      providerEnum === 'STRIPE'
        ? await this.prisma.subscription.findUnique({
            where: {
              stripeSubscriptionId: data.providerSubscriptionId,
            },
          })
        : null;

    const existingByRazorpay =
      providerEnum === 'RAZORPAY'
        ? await this.prisma.subscription.findUnique({
            where: {
              razorpaySubscriptionId: data.providerSubscriptionId,
            },
          })
        : null;

    if (existingByStripe || existingByRazorpay) return;

    if (!data.userId) {
      this.logger.warn(
        { providerSubscriptionId: data.providerSubscriptionId },
        'Webhook subscription_created missing userId',
      );
      return;
    }

    const subscriptionData: Record<string, unknown> = {
      userId: data.userId,
      provider: providerEnum,
      plan: data.plan,
      status: data.status,
      currentPeriodEnd: data.currentPeriodEnd,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
    };

    if (providerEnum === 'STRIPE') {
      subscriptionData['stripeCustomerId'] = data.providerCustomerId;
      subscriptionData['stripeSubscriptionId'] = data.providerSubscriptionId;
      subscriptionData['stripePriceId'] = data.providerPlanOrPriceId;
    } else {
      subscriptionData['razorpaySubscriptionId'] = data.providerSubscriptionId;
      subscriptionData['razorpayPlanId'] = data.providerPlanOrPriceId;
    }

    const createdSubscription = await this.prisma.subscription.create({
      data: subscriptionData as Parameters<
        typeof this.prisma.subscription.create
      >[0]['data'],
    });

    await this.prisma.user.update({
      where: { id: data.userId },
      data: { plan: data.plan },
    });

    if (payment) {
      await this.createInvoiceRecord(
        data.userId,
        createdSubscription.id,
        providerEnum,
        payment,
      );
    }

    this.logger.log(
      { userId: data.userId, plan: data.plan, provider: providerEnum },
      'Subscription created via webhook',
    );
  }

  private async handleSubscriptionUpdated(
    data: WebhookSubscriptionData,
    providerEnum: 'STRIPE' | 'RAZORPAY',
    payment?: WebhookPaymentData,
  ): Promise<void> {
    const existing = await this.findSubscriptionByProvider(
      data.providerSubscriptionId,
      providerEnum,
    );

    if (!existing) {
      this.logger.warn(
        {
          providerSubscriptionId: data.providerSubscriptionId,
          provider: providerEnum,
        },
        'Subscription updated but not found in DB',
      );
      return;
    }

    await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          plan: data.plan,
          status: data.status,
          currentPeriodEnd: data.currentPeriodEnd,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        },
      }),
      this.prisma.user.update({
        where: { id: existing.userId },
        data: { plan: data.plan },
      }),
    ]);

    if (payment) {
      await this.createInvoiceRecord(
        existing.userId,
        existing.id,
        providerEnum,
        payment,
      );
    }

    this.logger.log(
      {
        userId: existing.userId,
        plan: data.plan,
        status: data.status,
        provider: providerEnum,
      },
      'Subscription updated',
    );
  }

  private async handleSubscriptionDeleted(
    data: WebhookSubscriptionData,
    providerEnum: 'STRIPE' | 'RAZORPAY',
  ): Promise<void> {
    const existing = await this.findSubscriptionByProvider(
      data.providerSubscriptionId,
      providerEnum,
    );

    if (!existing) return;

    await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'CANCELED' },
      }),
      this.prisma.user.update({
        where: { id: existing.userId },
        data: { plan: 'FREE' },
      }),
    ]);

    this.logger.log(
      { userId: existing.userId, provider: providerEnum },
      'Subscription canceled, downgraded to FREE',
    );
  }

  private async handlePaymentFailed(
    data: WebhookSubscriptionData,
    providerEnum: 'STRIPE' | 'RAZORPAY',
  ): Promise<void> {
    const existing = await this.findSubscriptionByProvider(
      data.providerSubscriptionId,
      providerEnum,
    );

    if (!existing) return;

    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: { status: 'PAST_DUE' },
    });

    this.logger.warn(
      {
        userId: existing.userId,
        providerSubscriptionId: data.providerSubscriptionId,
        provider: providerEnum,
      },
      'Payment failed — subscription set to PAST_DUE',
    );
  }

  private async createInvoiceRecord(
    userId: string,
    subscriptionId: string,
    providerEnum: 'STRIPE' | 'RAZORPAY',
    payment: WebhookPaymentData,
  ): Promise<void> {
    const existingInvoice =
      providerEnum === 'STRIPE'
        ? await this.prisma.invoice.findUnique({
            where: { stripeInvoiceId: payment.providerPaymentId },
          })
        : await this.prisma.invoice.findUnique({
            where: { razorpayPaymentId: payment.providerPaymentId },
          });

    if (existingInvoice) return;

    const invoiceData: Record<string, unknown> = {
      userId,
      subscriptionId,
      provider: providerEnum,
      amountPaid: payment.amountPaid,
      currency: payment.currency,
      status: 'paid',
      paidAt: payment.paidAt,
    };

    if (providerEnum === 'STRIPE') {
      invoiceData['stripeInvoiceId'] = payment.providerPaymentId;
    } else {
      invoiceData['razorpayPaymentId'] = payment.providerPaymentId;
    }

    await this.prisma.invoice.create({
      data: invoiceData as Parameters<
        typeof this.prisma.invoice.create
      >[0]['data'],
    });

    this.logger.log(
      {
        userId,
        subscriptionId,
        provider: providerEnum,
        paymentId: payment.providerPaymentId,
        amount: payment.amountPaid,
      },
      'Invoice record created',
    );
  }

  private async findSubscriptionByProvider(
    providerSubscriptionId: string,
    providerEnum: 'STRIPE' | 'RAZORPAY',
  ) {
    if (providerEnum === 'STRIPE') {
      return this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: providerSubscriptionId },
      });
    }
    return this.prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: providerSubscriptionId },
    });
  }
}
