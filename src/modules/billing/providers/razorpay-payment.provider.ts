import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import { createHmac } from 'node:crypto';
import type {
  PaymentProvider,
  CheckoutParams,
  CheckoutResult,
  WebhookResult,
  WebhookPaymentData,
} from './payment-provider.interface.js';

interface RazorpayWebhookEvent {
  event: string;
  payload: {
    subscription?: { entity: RazorpaySubscriptionEntity };
    payment?: { entity: RazorpayPaymentEntity };
  };
}

interface RazorpaySubscriptionEntity {
  id: string;
  plan_id: string;
  customer_id: string | null;
  status: string;
  current_start: number | null;
  current_end: number | null;
  notes?: Record<string, string>;
}

interface RazorpayPaymentEntity {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: number;
  notes?: Record<string, string>;
}

@Injectable()
export class RazorpayPaymentProvider implements PaymentProvider, OnModuleInit {
  readonly providerName = 'razorpay' as const;

  private readonly logger = new Logger(RazorpayPaymentProvider.name);
  private razorpay!: Razorpay;
  private planMap!: Record<'PRO' | 'BYOK', string>;
  private keyId!: string;
  private keySecret!: string;
  private webhookSecret!: string;
  private configured = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
    const webhookSecret = this.configService.get<string>(
      'RAZORPAY_WEBHOOK_SECRET',
    );
    const planPro = this.configService.get<string>('RAZORPAY_PLAN_PRO');
    const planByok = this.configService.get<string>('RAZORPAY_PLAN_BYOK');

    if (!keyId || !keySecret || !webhookSecret || !planPro || !planByok) {
      this.logger.warn(
        'Razorpay env vars missing — provider disabled. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_PLAN_PRO, RAZORPAY_PLAN_BYOK to enable.',
      );
      return;
    }

    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret;

    this.razorpay = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret,
    });

    this.planMap = { PRO: planPro, BYOK: planByok };
    this.configured = true;
    this.logger.log('Razorpay payment provider initialized');
  }

  private ensureConfigured(): void {
    if (!this.configured) {
      throw new BadRequestException(
        'Razorpay is not configured. Add RAZORPAY_* env vars to enable it.',
      );
    }
  }

  async createCustomer(userId: string, email: string): Promise<string> {
    this.ensureConfigured();
    try {
      const customer = (await this.razorpay.customers.create({
        email,
        fail_existing: 0,
        notes: { userId },
      })) as unknown as { id: string };
      return customer.id;
    } catch (err: unknown) {
      // Razorpay throws if customer already exists — fetch existing customer
      const errorBody = err as { statusCode?: number; error?: { description?: string } };
      if (
        errorBody?.statusCode === 400 &&
        errorBody?.error?.description?.includes('Customer already exists')
      ) {
        this.logger.log({ email }, 'Razorpay customer already exists, fetching');
        const customers = (await this.razorpay.customers.all({
          count: 1,
        } as Record<string, unknown>)) as unknown as { items: { id: string; email: string }[] };
        const existing = customers.items?.find(
          (c) => c.email === email,
        );
        if (existing) return existing.id;
      }
      this.logger.error(
        { error: JSON.stringify(err), userId, email },
        'Razorpay createCustomer failed',
      );
      throw new BadRequestException('Payment provider error. Please try again.');
    }
  }

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    this.ensureConfigured();
    try {
      const subscription = await this.razorpay.subscriptions.create({
        plan_id: this.planMap[params.plan],
        total_count: 12,
        customer_notify: 1,
        notes: { userId: params.userId, plan: params.plan },
        // Razorpay SDK types don't include customer_id but the REST API accepts it
        ...({ customer_id: params.customerId } as Record<string, string>),
      });

      return {
        type: 'modal',
        subscriptionId: subscription.id,
        keyId: this.keyId,
        prefill: {
          name: params.userName,
          email: params.email,
        },
      };
    } catch (err: unknown) {
      this.logger.error(
        { error: JSON.stringify(err), plan: params.plan, customerId: params.customerId },
        'Razorpay createCheckoutSession failed',
      );
      throw new BadRequestException('Payment provider error. Please try again.');
    }
  }

  async createPortalSession(
    _customerId: string,
    _returnUrl: string,
  ): Promise<null> {
    return null;
  }

  async cancelSubscription(
    providerSubscriptionId: string,
    atPeriodEnd: boolean,
  ): Promise<void> {
    this.ensureConfigured();
    await this.razorpay.subscriptions.cancel(
      providerSubscriptionId,
      atPeriodEnd,
    );
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<WebhookResult> {
    this.ensureConfigured();
    const expectedSignature = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new BadRequestException('Invalid Razorpay webhook signature');
    }

    const event: RazorpayWebhookEvent = JSON.parse(rawBody.toString());

    switch (event.event) {
      case 'subscription.activated':
        return this.parseSubscriptionActivated(event);
      case 'subscription.charged':
        return this.parseSubscriptionCharged(event);
      case 'subscription.updated':
        return this.parseSubscriptionUpdated(event);
      case 'subscription.halted':
        return this.parseSubscriptionHalted(event);
      case 'subscription.cancelled':
        return this.parseSubscriptionCancelled(event);
      case 'subscription.completed':
        return this.parseSubscriptionCancelled(event);
      case 'payment.failed':
        return this.parsePaymentFailed(event);
      default:
        this.logger.log({ eventType: event.event }, 'Unhandled Razorpay event');
        return { action: 'ignored' };
    }
  }

  verifyPaymentSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): boolean {
    this.ensureConfigured();
    const expectedSignature = createHmac('sha256', this.keySecret)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex');

    return expectedSignature === signature;
  }

  private parseSubscriptionActivated(
    event: RazorpayWebhookEvent,
  ): WebhookResult {
    const sub = event.payload.subscription?.entity;
    if (!sub) return { action: 'ignored' };

    const payment = this.extractPaymentData(event);

    return {
      action: 'subscription_created',
      data: {
        providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer_id ?? '',
        providerPlanOrPriceId: sub.plan_id,
        plan: this.planToPlan(sub.plan_id),
        status: 'ACTIVE',
        currentPeriodEnd: sub.current_end
          ? new Date(sub.current_end * 1000)
          : new Date(),
        cancelAtPeriodEnd: false,
        userId: sub.notes?.['userId'],
      },
      payment,
    };
  }

  private parseSubscriptionCharged(event: RazorpayWebhookEvent): WebhookResult {
    const sub = event.payload.subscription?.entity;
    if (!sub) return { action: 'ignored' };

    const payment = this.extractPaymentData(event);

    return {
      action: 'subscription_updated',
      data: {
        providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer_id ?? '',
        providerPlanOrPriceId: sub.plan_id,
        plan: this.planToPlan(sub.plan_id),
        status: 'ACTIVE',
        currentPeriodEnd: sub.current_end
          ? new Date(sub.current_end * 1000)
          : new Date(),
        cancelAtPeriodEnd: false,
      },
      payment,
    };
  }

  private parseSubscriptionUpdated(event: RazorpayWebhookEvent): WebhookResult {
    const sub = event.payload.subscription?.entity;
    if (!sub) return { action: 'ignored' };

    const payment = this.extractPaymentData(event);

    return {
      action: 'subscription_updated',
      data: {
        providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer_id ?? '',
        providerPlanOrPriceId: sub.plan_id,
        plan: this.planToPlan(sub.plan_id),
        status: this.mapRazorpayStatus(sub.status),
        currentPeriodEnd: sub.current_end
          ? new Date(sub.current_end * 1000)
          : new Date(),
        cancelAtPeriodEnd: sub.status === 'cancelled',
      },
      payment,
    };
  }

  private parseSubscriptionHalted(event: RazorpayWebhookEvent): WebhookResult {
    const sub = event.payload.subscription?.entity;
    if (!sub) return { action: 'ignored' };

    return {
      action: 'payment_failed',
      data: {
        providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer_id ?? '',
        providerPlanOrPriceId: sub.plan_id,
        plan: this.planToPlan(sub.plan_id),
        status: 'PAST_DUE',
        currentPeriodEnd: sub.current_end
          ? new Date(sub.current_end * 1000)
          : new Date(),
        cancelAtPeriodEnd: false,
      },
    };
  }

  private parseSubscriptionCancelled(
    event: RazorpayWebhookEvent,
  ): WebhookResult {
    const sub = event.payload.subscription?.entity;
    if (!sub) return { action: 'ignored' };

    return {
      action: 'subscription_deleted',
      data: {
        providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer_id ?? '',
        providerPlanOrPriceId: sub.plan_id,
        plan: this.planToPlan(sub.plan_id),
        status: 'CANCELED',
        currentPeriodEnd: sub.current_end
          ? new Date(sub.current_end * 1000)
          : new Date(),
        cancelAtPeriodEnd: true,
      },
    };
  }

  private parsePaymentFailed(event: RazorpayWebhookEvent): WebhookResult {
    const sub = event.payload.subscription?.entity;
    if (!sub) return { action: 'ignored' };

    return {
      action: 'payment_failed',
      data: {
        providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer_id ?? '',
        providerPlanOrPriceId: sub.plan_id,
        plan: this.planToPlan(sub.plan_id),
        status: 'PAST_DUE',
        currentPeriodEnd: sub.current_end
          ? new Date(sub.current_end * 1000)
          : new Date(),
        cancelAtPeriodEnd: false,
      },
    };
  }

  private extractPaymentData(
    event: RazorpayWebhookEvent,
  ): WebhookPaymentData | undefined {
    const pay = event.payload.payment?.entity;
    if (!pay?.id) return undefined;

    return {
      providerPaymentId: pay.id,
      amountPaid: pay.amount ?? 0,
      currency: (pay.currency ?? 'inr').toLowerCase(),
      paidAt: pay.created_at ? new Date(pay.created_at * 1000) : new Date(),
    };
  }

  private planToPlan(planId: string): 'PRO' | 'BYOK' {
    if (planId === this.planMap.PRO) return 'PRO';
    if (planId === this.planMap.BYOK) return 'BYOK';
    this.logger.warn({ planId }, 'Unknown Razorpay plan ID');
    return 'PRO';
  }

  private mapRazorpayStatus(
    status: string,
  ): 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'TRIALING' {
    const mapping: Record<
      string,
      'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'TRIALING'
    > = {
      active: 'ACTIVE',
      authenticated: 'TRIALING',
      pending: 'PAST_DUE',
      halted: 'PAST_DUE',
      cancelled: 'CANCELED',
      completed: 'CANCELED',
      expired: 'CANCELED',
    };
    return mapping[status] ?? 'ACTIVE';
  }
}
