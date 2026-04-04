import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class CreateAgentRunDto {
  @ApiProperty({ description: 'Agent team ID' })
  @IsString()
  teamId!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  goal!: string;

  @ApiProperty({
    required: false,
    description: 'Override model (defaults to team model)',
  })
  @IsString()
  @IsOptional()
  model?: string;
}
