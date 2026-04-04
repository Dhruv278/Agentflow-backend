import type { SubscriptionStatus } from '@prisma/client';

export interface CheckoutParams {
  customerId: string;
  plan: 'PRO' | 'BYOK';
  userId: string;
  email: string;
  userName: string;
  successUrl: string;
  cancelUrl: string;
}

export type CheckoutResult =
  | { type: 'redirect'; url: string }
  | {
      type: 'modal';
      subscriptionId: string;
      keyId: string;
      prefill: { name: string; email: string };
    };

export type WebhookAction =
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_deleted'
  | 'payment_failed'
  | 'ignored';

export interface WebhookSubscriptionData {
  providerSubscriptionId: string;
  providerCustomerId: string;
  providerPlanOrPriceId: string;
  plan: 'PRO' | 'BYOK';
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  userId?: string;
}

export interface WebhookPaymentData {
  providerPaymentId: string;
  amountPaid: number;
  currency: string;
  paidAt: Date;
}

export interface WebhookResult {
  action: WebhookAction;
  data?: WebhookSubscriptionData;
  payment?: WebhookPaymentData;
}

export interface PaymentProvider {
  readonly providerName: 'stripe' | 'razorpay';

  createCustomer(userId: string, email: string): Promise<string>;

  createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult>;

  createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<string | null>;

  cancelSubscription(
    providerSubscriptionId: string,
    atPeriodEnd: boolean,
  ): Promise<void>;

  verifyAndParseWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<WebhookResult>;
}
