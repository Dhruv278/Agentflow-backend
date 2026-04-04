import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsIn,
  IsArray,
  IsBoolean,
  IsNumber,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAgentLibraryItemDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

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

  @ApiProperty({
    enum: ['Research', 'Content', 'Dev', 'Sales', 'Strategy', 'SEO'],
  })
  @IsString()
  @IsIn(['Research', 'Content', 'Dev', 'Sales', 'Strategy', 'SEO'])
  category!: string;
}

export class AgentLibraryItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() role!: string;
  @ApiProperty() category!: string;
  @ApiProperty() usageCount!: number;
  @ApiProperty() createdAt!: Date;
  // systemPrompt intentionally EXCLUDED — never sent to frontend
}

export class SaveTeamGraphAgentDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({
    enum: ['RESEARCHER', 'WRITER', 'REVIEWER', 'CODER', 'CRITIC', 'CUSTOM'],
  })
  @IsString()
  role!: string;

  @ApiProperty()
  @IsString()
  systemPrompt!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  libraryItemId?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class SaveTeamGraphConnectionDto {
  @ApiProperty()
  @IsNumber()
  fromAgentIndex!: number;

  @ApiProperty()
  @IsNumber()
  toAgentIndex!: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  inputKey?: string;
}

export class SaveTeamGraphDto {
  @ApiProperty({ type: [SaveTeamGraphAgentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveTeamGraphAgentDto)
  agents!: SaveTeamGraphAgentDto[];

  @ApiProperty({ type: [SaveTeamGraphConnectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveTeamGraphConnectionDto)
  connections!: SaveTeamGraphConnectionDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  canvasLayout?: Record<string, unknown>;
}
