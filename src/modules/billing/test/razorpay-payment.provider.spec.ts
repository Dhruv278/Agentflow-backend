import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { RazorpayPaymentProvider } from '../providers/razorpay-payment.provider';

describe('RazorpayPaymentProvider', () => {
  let provider: RazorpayPaymentProvider;
  const WEBHOOK_SECRET = 'test_webhook_secret_123';
  const KEY_SECRET = 'test_key_secret_456';

  beforeEach(() => {
    provider = new RazorpayPaymentProvider({
      get: jest.fn(),
      getOrThrow: jest.fn((key: string) => {
        const map: Record<string, string> = {
          RAZORPAY_KEY_ID: 'rzp_test_123',
          RAZORPAY_KEY_SECRET: KEY_SECRET,
          RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
          RAZORPAY_PLAN_PRO: 'plan_pro_123',
          RAZORPAY_PLAN_BYOK: 'plan_byok_456',
        };
        return map[key];
      }),
    } as any);

    // Manually set private fields since we skip onModuleInit (it calls Razorpay SDK)
    (provider as any).keyId = 'rzp_test_123';
    (provider as any).keySecret = KEY_SECRET;
    (provider as any).webhookSecret = WEBHOOK_SECRET;
    (provider as any).planMap = {
      PRO: 'plan_pro_123',
      BYOK: 'plan_byok_456',
    };
    (provider as any).configured = true;
  });

  describe('providerName', () => {
    it('should be "razorpay"', () => {
      expect(provider.providerName).toBe('razorpay');
    });
  });

  describe('createPortalSession', () => {
    it('should always return null (Razorpay has no portal)', async () => {
      const result = await provider.createPortalSession(
        'cust_123',
        'http://example.com',
      );
      expect(result).toBeNull();
    });
  });

  describe('verifyPaymentSignature', () => {
    it('should return true for valid signature', () => {
      const paymentId = 'pay_abc123';
      const subscriptionId = 'sub_def456';
      const validSignature = createHmac('sha256', KEY_SECRET)
        .update(`${paymentId}|${subscriptionId}`)
        .digest('hex');

      expect(
        provider.verifyPaymentSignature(
          paymentId,
          subscriptionId,
          validSignature,
        ),
      ).toBe(true);
    });

    it('should return false for invalid signature', () => {
      expect(
        provider.verifyPaymentSignature('pay_abc', 'sub_def', 'invalid_sig'),
      ).toBe(false);
    });

    it('should return false for empty signature', () => {
      expect(provider.verifyPaymentSignature('pay_abc', 'sub_def', '')).toBe(
        false,
      );
    });
  });

  describe('verifyAndParseWebhook', () => {
    function signPayload(payload: object): string {
      const raw = JSON.stringify(payload);
      return createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    }

    it('should throw BadRequestException on invalid signature', async () => {
      const body = Buffer.from(
        JSON.stringify({ event: 'subscription.activated' }),
      );
      await expect(
        provider.verifyAndParseWebhook(body, 'bad_signature'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should parse subscription.activated as subscription_created', async () => {
      const payload = {
        event: 'subscription.activated',
        payload: {
          subscription: {
            entity: {
              id: 'sub_123',
              plan_id: 'plan_pro_123',
              customer_id: 'cust_789',
              status: 'active',
              current_start: 1700000000,
              current_end: 1702592000,
              notes: { userId: 'user-uuid-1' },
            },
          },
        },
      };
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(payload);

      const result = await provider.verifyAndParseWebhook(raw, sig);
      expect(result.action).toBe('subscription_created');
      expect(result.data?.providerSubscriptionId).toBe('sub_123');
      expect(result.data?.providerCustomerId).toBe('cust_789');
      expect(result.data?.plan).toBe('PRO');
      expect(result.data?.status).toBe('ACTIVE');
      expect(result.data?.userId).toBe('user-uuid-1');
    });

    it('should parse subscription.charged as subscription_updated', async () => {
      const payload = {
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: 'sub_123',
              plan_id: 'plan_byok_456',
              customer_id: 'cust_789',
              status: 'active',
              current_start: 1700000000,
              current_end: 1702592000,
            },
          },
        },
      };
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(payload);

      const result = await provider.verifyAndParseWebhook(raw, sig);
      expect(result.action).toBe('subscription_updated');
      expect(result.data?.plan).toBe('BYOK');
      expect(result.data?.status).toBe('ACTIVE');
    });

    it('should parse subscription.halted as payment_failed', async () => {
      const payload = {
        event: 'subscription.halted',
        payload: {
          subscription: {
            entity: {
              id: 'sub_123',
              plan_id: 'plan_pro_123',
              customer_id: 'cust_789',
              status: 'halted',
              current_start: null,
              current_end: null,
            },
          },
        },
      };
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(payload);

      const result = await provider.verifyAndParseWebhook(raw, sig);
      expect(result.action).toBe('payment_failed');
      expect(result.data?.status).toBe('PAST_DUE');
    });

    it('should parse subscription.cancelled as subscription_deleted', async () => {
      const payload = {
        event: 'subscription.cancelled',
        payload: {
          subscription: {
            entity: {
              id: 'sub_123',
              plan_id: 'plan_pro_123',
              customer_id: 'cust_789',
              status: 'cancelled',
              current_start: null,
              current_end: null,
            },
          },
        },
      };
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(payload);

      const result = await provider.verifyAndParseWebhook(raw, sig);
      expect(result.action).toBe('subscription_deleted');
      expect(result.data?.status).toBe('CANCELED');
    });

    it('should return ignored for unknown event types', async () => {
      const payload = { event: 'order.paid', payload: {} };
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(payload);

      const result = await provider.verifyAndParseWebhook(raw, sig);
      expect(result.action).toBe('ignored');
    });

    it('should return ignored when subscription entity is missing', async () => {
      const payload = {
        event: 'subscription.activated',
        payload: {},
      };
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(payload);

      const result = await provider.verifyAndParseWebhook(raw, sig);
      expect(result.action).toBe('ignored');
    });

    it('should map unknown plan_id to PRO by default', async () => {
      const payload = {
        event: 'subscription.activated',
        payload: {
          subscription: {
            entity: {
              id: 'sub_123',
              plan_id: 'plan_unknown_999',
              customer_id: 'cust_789',
              status: 'active',
              current_start: 1700000000,
              current_end: 1702592000,
              notes: { userId: 'user-uuid-1' },
            },
          },
        },
      };
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(payload);

      const result = await provider.verifyAndParseWebhook(raw, sig);
      expect(result.data?.plan).toBe('PRO');
    });
  });
});
