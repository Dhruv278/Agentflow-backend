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
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAgentDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  id?: string;

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

export class UpdateAgentTeamDto {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(500)
  name?: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ required: false, maxLength: 5000 })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  goal?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({ required: false, type: [UpdateAgentDto], maxItems: 10 })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => UpdateAgentDto)
  agents?: UpdateAgentDto[];
}
