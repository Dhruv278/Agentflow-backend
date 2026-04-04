import { Module } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { BillingController } from './billing.controller.js';
import { PaymentGatewayService } from './payment-gateway.service.js';
import { StripePaymentProvider } from './providers/stripe-payment.provider.js';
import { RazorpayPaymentProvider } from './providers/razorpay-payment.provider.js';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    PaymentGatewayService,
    StripePaymentProvider,
    RazorpayPaymentProvider,
  ],
  exports: [BillingService],
})
export class BillingModule {}
