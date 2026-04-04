import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({
    enum: ['PRO', 'BYOK'],
    description: 'Target subscription plan',
  })
  @IsString()
  @IsIn(['PRO', 'BYOK'], { message: 'Plan must be PRO or BYOK' })
  plan!: 'PRO' | 'BYOK';
}
