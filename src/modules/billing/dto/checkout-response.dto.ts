import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class VerifyRazorpayPaymentDto {
  @ApiProperty({ description: 'Razorpay payment ID from checkout callback' })
  @IsString()
  razorpay_payment_id!: string;

  @ApiProperty({
    description: 'Razorpay subscription ID from checkout callback',
  })
  @IsString()
  razorpay_subscription_id!: string;

  @ApiProperty({ description: 'Razorpay signature from checkout callback' })
  @IsString()
  razorpay_signature!: string;
}

export class SetActiveProviderDto {
  @ApiProperty({
    enum: ['stripe', 'razorpay'],
    description: 'Payment provider to activate',
  })
  @IsString()
  @IsIn(['stripe', 'razorpay'], {
    message: 'Provider must be stripe or razorpay',
  })
  provider!: 'stripe' | 'razorpay';
}
