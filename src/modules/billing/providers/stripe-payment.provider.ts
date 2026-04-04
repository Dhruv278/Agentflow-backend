import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { SubscriptionStatus } from '@prisma/client';
import type {
  PaymentProvider,
  CheckoutParams,
  CheckoutResult,
  WebhookResult,
  WebhookPaymentData,
} from './payment-provider.interface.js';

@Injectable()
export class StripePaymentProvider implements PaymentProvider, OnModuleInit {
  readonly providerName = 'stripe' as const;

  private readonly logger = new Logger(StripePaymentProvider.name);
  private stripe!: Stripe;
  private priceMap!: Record<'PRO' | 'BYOK', string>;
  private webhookSecret!: string;
  private configured = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    const pricePro = this.configService.get<string>('STRIPE_PRICE_PRO');
    const priceByok = this.configService.get<string>('STRIPE_PRICE_BYOK');

    if (!secretKey || !webhookSecret || !pricePro || !priceByok) {
      this.logger.warn(
        'Stripe env vars missing — provider disabled. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_BYOK to enable.',
      );
      return;
    }

    this.webhookSecret = webhookSecret;
    this.stripe = new Stripe(secretKey);
    this.priceMap = { PRO: pricePro, BYOK: priceByok };
    this.configured = true;
    this.logger.log('Stripe payment provider initialized');
  }

  private ensureConfigured(): void {
    if (!this.configured) {
      throw new BadRequestException(
        'Stripe is not configured. Add STRIPE_* env vars to enable it.',
      );
    }
  }

  async createCustomer(userId: string, email: string): Promise<string> {
    this.ensureConfigured();
    const customer = await this.stripe.customers.create({
      email,
      metadata: { userId },
    });
    return customer.id;
  }

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    this.ensureConfigured();
    const session = await this.stripe.checkout.sessions.create({
      customer: params.customerId,
      mode: 'subscription',
      currency: 'inr',
      line_items: [{ price: this.priceMap[params.plan], quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { userId: params.userId, plan: params.plan },
      subscription_data: {
        metadata: { userId: params.userId, plan: params.plan },
      },
    });

    if (!session.url) {
      throw new BadRequestException('Failed to create Stripe checkout session');
    }

    return { type: 'redirect', url: session.url };
  }

  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<string> {
    this.ensureConfigured();
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  async cancelSubscription(
    providerSubscriptionId: string,
    atPeriodEnd: boolean,
  ): Promise<void> {
    this.ensureConfigured();
    if (atPeriodEnd) {
      await this.stripe.subscriptions.update(providerSubscriptionId, {
        cancel_at_period_end: true,
      });
    } else {
      await this.stripe.subscriptions.cancel(providerSubscriptionId);
    }
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<WebhookResult> {
    this.ensureConfigured();
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed':
        return this.parseCheckoutCompleted(event);
      case 'customer.subscription.updated':
        return this.parseSubscriptionUpdated(event);
      case 'customer.subscription.deleted':
        return this.parseSubscriptionDeleted(event);
      case 'invoice.payment_succeeded':
        return this.parseInvoicePaymentSucceeded(event);
      case 'invoice.payment_failed':
        return this.parseInvoicePaymentFailed(event);
      default:
        this.logger.log({ eventType: event.type }, 'Unhandled Stripe event');
        return { action: 'ignored' };
    }
  }

  private async parseCheckoutCompleted(
    event: Stripe.Event,
  ): Promise<WebhookResult> {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode !== 'subscription') {
      return { action: 'ignored' };
    }

    const userId = session.metadata?.['userId'];
    const subscriptionId = session.subscription as string;

    if (!userId || !subscriptionId) {
      this.logger.warn('Checkout session missing userId or subscription');
      return { action: 'ignored' };
    }

    const stripeSubscription = await this.stripe.subscriptions.retrieve(
      subscriptionId,
      {
        expand: ['latest_invoice'],
      },
    );
    const priceId = stripeSubscription.items.data[0]?.price.id ?? '';
    const plan = this.priceToPlan(priceId);
    const customerId =
      typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer.id;

    let payment: WebhookPaymentData | undefined;
    const latestInvoice = stripeSubscription.latest_invoice;
    if (latestInvoice && typeof latestInvoice === 'object') {
      payment = {
        providerPaymentId: latestInvoice.id,
        amountPaid: latestInvoice.amount_paid ?? 0,
        currency: (latestInvoice.currency ?? 'inr').toLowerCase(),
        paidAt: latestInvoice.status_transitions?.paid_at
          ? new Date(latestInvoice.status_transitions.paid_at * 1000)
          : new Date(),
      };
    }

    return {
      action: 'subscription_created',
      data: {
        providerSubscriptionId: subscriptionId,
        providerCustomerId: customerId,
        providerPlanOrPriceId: priceId,
        plan,
        status: this.mapStripeStatus(stripeSubscription.status),
        currentPeriodEnd: new Date(
          stripeSubscription.items.data[0]?.current_period_end
            ? stripeSubscription.items.data[0].current_period_end * 1000
            : Date.now(),
        ),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        userId,
      },
      payment,
    };
  }

  private parseSubscriptionUpdated(event: Stripe.Event): WebhookResult {
    const stripeSubscription = event.data.object as Stripe.Subscription;
    const priceId = stripeSubscription.items.data[0]?.price.id ?? '';
    const plan = this.priceToPlan(priceId);
    const customerId =
      typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer.id;

    return {
      action: 'subscription_updated',
      data: {
        providerSubscriptionId: stripeSubscription.id,
        providerCustomerId: customerId,
        providerPlanOrPriceId: priceId,
        plan,
        status: this.mapStripeStatus(stripeSubscription.status),
        currentPeriodEnd: new Date(
          stripeSubscription.items.data[0]?.current_period_end
            ? stripeSubscription.items.data[0].current_period_end * 1000
            : Date.now(),
        ),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
    };
  }

  private parseSubscriptionDeleted(event: Stripe.Event): WebhookResult {
    const stripeSubscription = event.data.object as Stripe.Subscription;
    const priceId = stripeSubscription.items.data[0]?.price.id ?? '';

    return {
      action: 'subscription_deleted',
      data: {
        providerSubscriptionId: stripeSubscription.id,
        providerCustomerId:
          typeof stripeSubscription.customer === 'string'
            ? stripeSubscription.customer
            : stripeSubscription.customer.id,
        providerPlanOrPriceId: priceId,
        plan: this.priceToPlan(priceId),
        status: 'CANCELED',
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: true,
      },
    };
  }

  private parseInvoicePaymentSucceeded(event: Stripe.Event): WebhookResult {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      typeof invoice.parent?.subscription_details?.subscription === 'string'
        ? invoice.parent.subscription_details.subscription
        : null;

    if (!subscriptionId) {
      return { action: 'ignored' };
    }

    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : (invoice.customer?.id ?? '');

    const lineItem = invoice.lines?.data?.[0] as unknown as
      | Record<string, unknown>
      | undefined;
    const priceId =
      ((lineItem?.['price'] as Record<string, unknown> | undefined)?.[
        'id'
      ] as string) ?? '';

    const payment: WebhookPaymentData = {
      providerPaymentId: invoice.id,
      amountPaid: invoice.amount_paid ?? 0,
      currency: (invoice.currency ?? 'inr').toLowerCase(),
      paidAt: invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : new Date(),
    };

    return {
      action: 'subscription_updated',
      data: {
        providerSubscriptionId: subscriptionId,
        providerCustomerId: customerId,
        providerPlanOrPriceId: priceId,
        plan: priceId ? this.priceToPlan(priceId) : 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
      },
      payment,
    };
  }

  private parseInvoicePaymentFailed(event: Stripe.Event): WebhookResult {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      typeof invoice.parent?.subscription_details?.subscription === 'string'
        ? invoice.parent.subscription_details.subscription
        : null;

    if (!subscriptionId) {
      return { action: 'ignored' };
    }

    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : (invoice.customer?.id ?? '');

    const lineItem = invoice.lines?.data?.[0] as unknown as
      | Record<string, unknown>
      | undefined;
    const priceId =
      ((lineItem?.['price'] as Record<string, unknown> | undefined)?.[
        'id'
      ] as string) ?? '';

    return {
      action: 'payment_failed',
      data: {
        providerSubscriptionId: subscriptionId,
        providerCustomerId: customerId,
        providerPlanOrPriceId: priceId,
        plan: priceId ? this.priceToPlan(priceId) : 'PRO',
        status: 'PAST_DUE',
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
      },
    };
  }

  private priceToPlan(priceId: string): 'PRO' | 'BYOK' {
    if (priceId === this.priceMap.PRO) return 'PRO';
    if (priceId === this.priceMap.BYOK) return 'BYOK';
    this.logger.warn({ priceId }, 'Unknown Stripe price ID');
    return 'PRO';
  }

  private mapStripeStatus(
    status: Stripe.Subscription.Status,
  ): SubscriptionStatus {
    const mapping: Record<string, SubscriptionStatus> = {
      active: 'ACTIVE',
      canceled: 'CANCELED',
      past_due: 'PAST_DUE',
      trialing: 'TRIALING',
    };
    return mapping[status] ?? 'ACTIVE';
  }
}
