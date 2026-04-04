import { ApiProperty } from '@nestjs/swagger';

export class OrKeyStatusResponseDto {
  @ApiProperty({ description: 'Whether the user has a stored OpenRouter key' })
  hasKey!: boolean;

  @ApiProperty({
    description: 'When the key was added',
    nullable: true,
    type: String,
  })
  addedAt!: Date | null;

  @ApiProperty({
    description: 'When the key was last used for an API call',
    nullable: true,
    type: String,
  })
  lastUsedAt!: Date | null;
}
