import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';
import { SubscriptionResponseDto } from './dto/subscription-response.dto.js';
import {
  VerifyRazorpayPaymentDto,
  SetActiveProviderDto,
} from './dto/checkout-response.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator.js';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create checkout session (Stripe redirect or Razorpay modal)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns checkout data (type: redirect or modal)',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async createCheckout(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCheckoutDto,
  ) {
    const result = await this.billingService.createCheckoutSession(
      user.id,
      user.email,
      dto.plan,
    );
    return { data: result };
  }

  // Kept for backward compatibility with existing Stripe webhook config
  @Post('webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook endpoint (legacy alias)' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature' })
  async handleWebhookLegacy(@Req() req: RawBodyRequest<Request>) {
    return this.handleStripeWebhook(req);
  }

  @Post('webhook/stripe')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature' })
  async handleStripeWebhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['stripe-signature'];
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Missing Stripe signature or raw body');
    }
    await this.billingService.handleStripeWebhook(
      req.rawBody,
      signature as string,
    );
    return { received: true };
  }

  @Post('webhook/razorpay')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature' })
  async handleRazorpayWebhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Missing Razorpay signature or raw body');
    }
    await this.billingService.handleRazorpayWebhook(
      req.rawBody,
      signature as string,
    );
    return { received: true };
  }

  @Post('razorpay/verify')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify Razorpay payment signature after modal checkout',
  })
  @ApiResponse({ status: 200, description: 'Payment verified' })
  @ApiResponse({ status: 400, description: 'Invalid payment signature' })
  async verifyRazorpayPayment(@Body() dto: VerifyRazorpayPaymentDto) {
    const isValid = this.billingService.verifyRazorpayPayment(
      dto.razorpay_payment_id,
      dto.razorpay_subscription_id,
      dto.razorpay_signature,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid Razorpay payment signature');
    }

    return { data: { verified: true } };
  }

  @Post('cancel')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel subscription at period end' })
  @ApiResponse({ status: 200, description: 'Cancellation requested' })
  @ApiResponse({ status: 404, description: 'No active subscription' })
  async cancelSubscription(@CurrentUser() user: RequestUser) {
    await this.billingService.cancelSubscription(user.id);
    return { data: { message: 'Subscription will be canceled at period end' } };
  }

  @Post('portal')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Create billing portal session (Stripe only, returns null for Razorpay)',
  })
  @ApiResponse({ status: 200, description: 'Returns portal URL or null' })
  async createPortal(@CurrentUser() user: RequestUser) {
    const result = await this.billingService.createPortalSession(user.id);
    return { data: result };
  }

  @Get('subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current subscription details' })
  @ApiResponse({ status: 200, type: SubscriptionResponseDto })
  async getSubscription(@CurrentUser() user: RequestUser) {
    const subscription = await this.billingService.getSubscription(user.id);
    return { data: subscription };
  }

  @Get('active-provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the currently active payment provider' })
  @ApiResponse({ status: 200, description: 'Returns active provider name' })
  async getActiveProvider() {
    const provider = await this.billingService.getActiveProvider();
    return { data: { provider } };
  }

  @Patch('admin/provider')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set active payment provider (admin only)' })
  @ApiResponse({ status: 200, description: 'Provider updated' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async setActiveProvider(
    @CurrentUser() user: RequestUser,
    @Body() dto: SetActiveProviderDto,
  ) {
    await this.billingService.setActiveProvider(dto.provider, user.email);
    return { data: { provider: dto.provider } };
  }
}
