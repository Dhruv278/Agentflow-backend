import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class SaveOrKeyDto {
  @ApiProperty({ description: 'OpenRouter API key', example: 'sk-or-v1-...' })
  @IsString()
  @MinLength(10, { message: 'API key is too short' })
  @MaxLength(500, { message: 'API key is too long' })
  key!: string;
}
