import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  IsBoolean,
  IsInt,
  MaxLength,
  MinLength,
  Min,
  Max,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAgentDto {
  @ApiProperty({
    enum: ['RESEARCHER', 'WRITER', 'REVIEWER', 'CODER', 'CRITIC', 'CUSTOM'],
  })
  @IsString()
  @IsIn(['RESEARCHER', 'WRITER', 'REVIEWER', 'CODER', 'CRITIC', 'CUSTOM'])
  role!: string;

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  systemPrompt!: string;

  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  order!: number;

  @ApiProperty({ default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class CreateAgentTeamDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  goal!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({ type: [CreateAgentDto], minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateAgentDto)
  agents!: CreateAgentDto[];
}
