import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePass123' })
  @IsString()
  password!: string;
}
