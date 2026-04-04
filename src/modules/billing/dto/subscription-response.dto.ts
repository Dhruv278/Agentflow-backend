import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionResponseDto {
  @ApiProperty({ enum: ['FREE', 'PRO', 'BYOK'] })
  plan!: string;

  @ApiProperty({ enum: ['ACTIVE', 'CANCELED', 'PAST_DUE', 'TRIALING'] })
  status!: string;

  @ApiProperty()
  currentPeriodEnd!: Date;

  @ApiProperty()
  cancelAtPeriodEnd!: boolean;

  @ApiProperty({ enum: ['STRIPE', 'RAZORPAY'] })
  provider!: string;

  @ApiProperty()
  createdAt!: Date;
}
